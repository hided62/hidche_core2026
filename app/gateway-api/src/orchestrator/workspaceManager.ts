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

export class GitWorkspaceManager {
    private readonly repoRoot: string;
    private readonly worktreeRoot: string;
    private readonly baseEnv?: Record<string, string>;

    constructor(options: WorkspaceManagerOptions) {
        this.repoRoot = options.repoRoot;
        this.worktreeRoot = options.worktreeRoot;
        this.baseEnv = options.baseEnv;
    }

    async prepare(commitSha: string): Promise<WorkspaceInfo> {
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
        }

        return {
            root: workspacePath,
            created: !exists,
            needsInstall: !hasInstallMarker(workspacePath),
        };
    }

    async remove(workspacePath: string): Promise<boolean> {
        const resolved = path.resolve(workspacePath);
        const root = path.resolve(this.worktreeRoot);
        if (!resolved.startsWith(root)) {
            throw new Error('Workspace path is outside the configured worktree root.');
        }
        if (!fs.existsSync(resolved)) {
            return false;
        }
        const result = await runGit(['worktree', 'remove', '--force', resolved], this.repoRoot, this.baseEnv);
        if (!result.ok) {
            fs.rmSync(resolved, { recursive: true, force: true });
        }
        return true;
    }
}
