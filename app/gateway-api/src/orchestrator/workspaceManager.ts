import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface WorkspaceManagerOptions {
    repoRoot: string;
    worktreeRoot: string;
    baseEnv?: Record<string, string>;
    now?: () => Date;
}

export interface WorkspaceInfo {
    root: string;
    created: boolean;
    needsInstall: boolean;
}

export interface ManagedWorkspaceInfo {
    root: string;
    commitSha: string;
    lastUsedAt: Date;
}

export interface ManagedWorkspaceCleanupOptions {
    protectedPaths?: readonly string[];
    retentionMs: number;
    keepNewest: number;
}

export interface ManagedWorkspaceCleanupResult {
    removed: string[];
    skipped: string[];
}

export const DEFAULT_MANAGED_WORKSPACE_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_MANAGED_WORKSPACE_KEEP_NEWEST = 2;

const runGit = (args: string[], cwd: string, env?: Record<string, string>): Promise<{ ok: boolean; output: string }> =>
    new Promise((resolve) => {
        const child = spawn('git', args, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.on('error', (error) => {
            resolve({ ok: false, output: `${output}${error.message}` });
        });
        child.on('close', (code) => {
            resolve({ ok: code === 0, output });
        });
    });

const ensureDir = (dir: string): void => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

const hasInstallMarker = (dir: string): boolean => fs.existsSync(path.join(dir, 'node_modules', '.pnpm'));
const GIT_REF_PATTERN = /^[0-9A-Za-z._/-]+$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const PERSISTENT_RELEASE_REF_PATTERN = /^refs\/sammo\/[a-z0-9][a-z0-9._/-]{0,127}$/u;
const NULL_COMMIT_SHA = '0'.repeat(40);

const assertGitRef = (value: string): string => {
    const ref = value.trim();
    if (!ref || ref.startsWith('-') || ref.includes('..') || !GIT_REF_PATTERN.test(ref)) {
        throw new Error('Invalid git ref.');
    }
    return ref;
};

export class GitWorkspaceManager {
    private readonly repoRoot: string;
    private readonly worktreeRoot: string;
    private readonly baseEnv?: Record<string, string>;
    private readonly now: () => Date;

    constructor(options: WorkspaceManagerOptions) {
        this.repoRoot = options.repoRoot;
        this.worktreeRoot = options.worktreeRoot;
        this.baseEnv = options.baseEnv;
        this.now = options.now ?? (() => new Date());
    }

    async resolveCommit(sourceMode: 'BRANCH' | 'COMMIT', sourceRef: string): Promise<string> {
        const ref = assertGitRef(sourceRef);
        if (sourceMode === 'BRANCH') {
            const fetched = await runGit(['fetch', '--all', '--prune'], this.repoRoot, this.baseEnv);
            if (!fetched.ok) {
                throw new Error(fetched.output || 'Failed to fetch git branches.');
            }
        }
        const candidates =
            sourceMode === 'BRANCH'
                ? [`refs/remotes/origin/${ref}^{commit}`, `refs/heads/${ref}^{commit}`]
                : [`${ref}^{commit}`];
        const resolveCandidates = async (): Promise<string | undefined> => {
            for (const candidate of candidates) {
                const result = await runGit(['rev-parse', '--verify', candidate], this.repoRoot, this.baseEnv);
                const commitSha = result.output.trim().split('\n')[0];
                if (result.ok && /^[0-9a-f]{40}$/i.test(commitSha)) {
                    return commitSha;
                }
            }
            return undefined;
        };
        const localCommit = await resolveCandidates();
        if (localCommit) return localCommit;
        if (sourceMode === 'COMMIT') {
            const fetched = await runGit(['fetch', '--all', '--tags'], this.repoRoot, this.baseEnv);
            if (!fetched.ok) {
                throw new Error(fetched.output || 'Failed to fetch git commits.');
            }
            const fetchedCommit = await resolveCandidates();
            if (fetchedCommit) return fetchedCommit;
        }
        throw new Error(`${sourceMode === 'BRANCH' ? 'Branch' : 'Commit'} not found.`);
    }

    async readPersistentReleaseRef(ref: string): Promise<string | null> {
        if (!PERSISTENT_RELEASE_REF_PATTERN.test(ref)) {
            throw new Error('Persistent release ref must be below refs/sammo/.');
        }
        const result = await runGit(['rev-parse', '--verify', `${ref}^{commit}`], this.repoRoot, this.baseEnv);
        if (!result.ok) return null;
        const commitSha = result.output.trim().split('\n')[0];
        if (!COMMIT_SHA_PATTERN.test(commitSha)) {
            throw new Error(`Persistent release ref does not resolve to a commit: ${ref}`);
        }
        return commitSha.toLowerCase();
    }

    async compareAndSwapPersistentReleaseRef(
        ref: string,
        expectedCommitSha: string | null,
        nextCommitSha: string | null
    ): Promise<void> {
        if (!PERSISTENT_RELEASE_REF_PATTERN.test(ref)) {
            throw new Error('Persistent release ref must be below refs/sammo/.');
        }
        for (const commitSha of [expectedCommitSha, nextCommitSha]) {
            if (commitSha !== null && !COMMIT_SHA_PATTERN.test(commitSha)) {
                throw new Error('Persistent release ref commit must be a full SHA.');
            }
        }
        if (nextCommitSha) {
            const exists = await runGit(['cat-file', '-e', `${nextCommitSha}^{commit}`], this.repoRoot, this.baseEnv);
            if (!exists.ok) throw new Error(`Persistent release commit is unavailable: ${nextCommitSha}`);
        }
        const args = nextCommitSha
            ? ['update-ref', ref, nextCommitSha, expectedCommitSha ?? NULL_COMMIT_SHA]
            : ['update-ref', '-d', ref, expectedCommitSha ?? NULL_COMMIT_SHA];
        const updated = await runGit(args, this.repoRoot, this.baseEnv);
        if (!updated.ok) {
            throw new Error(
                `Failed to update persistent release ref ${ref}${updated.output ? `: ${updated.output.trim()}` : ''}`
            );
        }
    }

    async prepare(commitSha: string): Promise<WorkspaceInfo> {
        if (!COMMIT_SHA_PATTERN.test(commitSha)) {
            throw new Error('Invalid commit SHA.');
        }
        const workspacePath = path.join(this.worktreeRoot, commitSha);
        ensureDir(this.worktreeRoot);

        const exists = fs.existsSync(workspacePath);
        if (!exists) {
            const hasCommit = await runGit(['cat-file', '-e', `${commitSha}^{commit}`], this.repoRoot, this.baseEnv);
            if (!hasCommit.ok) {
                await runGit(['fetch', '--all', '--tags'], this.repoRoot, this.baseEnv);
            }
            const result = await runGit(
                ['worktree', 'add', '--detach', workspacePath, commitSha],
                this.repoRoot,
                this.baseEnv
            );
            if (!result.ok) {
                throw new Error(result.output || 'Failed to create git worktree.');
            }
        } else {
            await this.assertReusableWorkspace(workspacePath, commitSha);
        }
        const usedAt = this.now();
        fs.utimesSync(workspacePath, usedAt, usedAt);

        return {
            root: workspacePath,
            created: !exists,
            needsInstall: !hasInstallMarker(workspacePath),
        };
    }

    async remove(workspacePath: string): Promise<boolean> {
        const resolved = this.assertManagedWorkspacePath(workspacePath);
        if (!fs.existsSync(resolved)) {
            return false;
        }
        await this.assertRegisteredWorkspace(resolved);
        const status = await runGit(['status', '--porcelain'], resolved, this.baseEnv);
        if (!status.ok) {
            throw new Error(status.output || 'Failed to inspect managed workspace.');
        }
        if (status.output.trim()) {
            throw new Error('Managed workspace has uncommitted changes.');
        }
        const result = await runGit(['worktree', 'remove', '--force', resolved], this.repoRoot, this.baseEnv);
        if (!result.ok) {
            throw new Error(result.output || 'Failed to remove git worktree.');
        }
        return true;
    }

    workspacePathForCommit(commitSha: string): string {
        if (!COMMIT_SHA_PATTERN.test(commitSha)) {
            throw new Error('Invalid commit SHA.');
        }
        return path.join(this.worktreeRoot, commitSha);
    }

    async listManagedWorkspaces(): Promise<ManagedWorkspaceInfo[]> {
        const listed = await runGit(['worktree', 'list', '--porcelain'], this.repoRoot, this.baseEnv);
        if (!listed.ok) {
            throw new Error(listed.output || 'Failed to inspect git worktrees.');
        }
        const workspaces: ManagedWorkspaceInfo[] = [];
        for (const block of listed.output.split(/\n\n+/)) {
            const lines = block.split('\n');
            const worktreeLine = lines.find((line) => line.startsWith('worktree '));
            const headLine = lines.find((line) => line.startsWith('HEAD '));
            if (!worktreeLine || !headLine) continue;
            const workspacePath = path.resolve(worktreeLine.slice('worktree '.length));
            const commitSha = headLine.slice('HEAD '.length);
            try {
                this.assertManagedWorkspacePath(workspacePath);
            } catch {
                continue;
            }
            if (!COMMIT_SHA_PATTERN.test(commitSha) || !fs.existsSync(workspacePath)) continue;
            workspaces.push({
                root: workspacePath,
                commitSha,
                lastUsedAt: fs.statSync(workspacePath).mtime,
            });
        }
        return workspaces;
    }

    async cleanup(options: ManagedWorkspaceCleanupOptions): Promise<ManagedWorkspaceCleanupResult> {
        if (!Number.isFinite(options.retentionMs) || options.retentionMs < 0) {
            throw new Error('Workspace retention must be a non-negative duration.');
        }
        if (!Number.isInteger(options.keepNewest) || options.keepNewest < 0) {
            throw new Error('Workspace keepNewest must be a non-negative integer.');
        }
        const protectedPaths = new Set((options.protectedPaths ?? []).map((item) => path.resolve(item)));
        const workspaces = await this.listManagedWorkspaces();
        const unprotectedNewest = [...workspaces]
            .filter((workspace) => !protectedPaths.has(workspace.root))
            .sort((left, right) => right.lastUsedAt.getTime() - left.lastUsedAt.getTime())
            .slice(0, options.keepNewest);
        const retainedNewestPaths = new Set(unprotectedNewest.map((workspace) => workspace.root));
        const cutoff = this.now().getTime() - options.retentionMs;
        const removed: string[] = [];
        const skipped: string[] = [];

        for (const workspace of workspaces) {
            if (
                protectedPaths.has(workspace.root) ||
                retainedNewestPaths.has(workspace.root) ||
                workspace.lastUsedAt.getTime() > cutoff
            ) {
                skipped.push(workspace.root);
                continue;
            }
            try {
                if (await this.remove(workspace.root)) {
                    removed.push(workspace.root);
                } else {
                    skipped.push(workspace.root);
                }
            } catch {
                skipped.push(workspace.root);
            }
        }

        const pruned = await runGit(['worktree', 'prune', '--expire', 'now'], this.repoRoot, this.baseEnv);
        if (!pruned.ok) {
            throw new Error(pruned.output || 'Failed to prune git worktree metadata.');
        }
        return { removed, skipped };
    }

    private assertManagedWorkspacePath(workspacePath: string): string {
        const resolved = path.resolve(workspacePath);
        const root = path.resolve(this.worktreeRoot);
        const relative = path.relative(root, resolved);
        if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            throw new Error('Workspace path must be a child of the configured worktree root.');
        }
        if (relative.includes(path.sep) || !COMMIT_SHA_PATTERN.test(relative)) {
            throw new Error('Workspace path is not a managed commit workspace.');
        }
        return resolved;
    }

    private async assertRegisteredWorkspace(workspacePath: string, expectedCommitSha?: string): Promise<void> {
        const listed = await runGit(['worktree', 'list', '--porcelain'], this.repoRoot, this.baseEnv);
        if (!listed.ok) {
            throw new Error(listed.output || 'Failed to inspect git worktrees.');
        }
        const blocks = listed.output.split(/\n\n+/);
        const matchingBlock = blocks.find((block) => {
            const worktreeLine = block.split('\n').find((line) => line.startsWith('worktree '));
            return worktreeLine && path.resolve(worktreeLine.slice('worktree '.length)) === workspacePath;
        });
        if (!matchingBlock) {
            throw new Error('Workspace is not registered as a git worktree.');
        }
        if (expectedCommitSha) {
            const headLine = matchingBlock.split('\n').find((line) => line.startsWith('HEAD '));
            if (headLine?.slice('HEAD '.length).toLowerCase() !== expectedCommitSha.toLowerCase()) {
                throw new Error('Existing workspace HEAD does not match the requested commit.');
            }
        }
    }

    private async assertReusableWorkspace(workspacePath: string, expectedCommitSha: string): Promise<void> {
        const resolved = this.assertManagedWorkspacePath(workspacePath);
        await this.assertRegisteredWorkspace(resolved, expectedCommitSha);
        const status = await runGit(['status', '--porcelain'], resolved, this.baseEnv);
        if (!status.ok) {
            throw new Error(status.output || 'Failed to inspect existing workspace.');
        }
        if (status.output.trim()) {
            throw new Error('Existing workspace has uncommitted changes.');
        }
    }
}
