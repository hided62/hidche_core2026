import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface WorkspaceManagerOptions {
    repoRoot: string;
    worktreeRoot: string;
    baseEnv?: Record<string, string>;
}

export interface WorkspaceInfo {
    root: string;
    created: boolean;
    needsInstall: boolean;
}

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

    constructor(options: WorkspaceManagerOptions) {
        this.repoRoot = options.repoRoot;
        this.worktreeRoot = options.worktreeRoot;
        this.baseEnv = options.baseEnv;
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
        for (const candidate of candidates) {
            const result = await runGit(['rev-parse', '--verify', candidate], this.repoRoot, this.baseEnv);
            const commitSha = result.output.trim().split('\n')[0];
            if (result.ok && /^[0-9a-f]{40}$/i.test(commitSha)) {
                return commitSha;
            }
        }
        throw new Error(`${sourceMode === 'BRANCH' ? 'Branch' : 'Commit'} not found.`);
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
        const result = await runGit(['worktree', 'remove', '--force', resolved], this.repoRoot, this.baseEnv);
        if (!result.ok) {
            fs.rmSync(resolved, { recursive: true, force: true });
        }
        return true;
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
