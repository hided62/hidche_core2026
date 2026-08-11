import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { GitWorkspaceManager } from '../src/orchestrator/workspaceManager.js';

const temporaryRoots: string[] = [];

const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'Sammo Test',
            GIT_AUTHOR_EMAIL: 'sammo-test@example.invalid',
            GIT_COMMITTER_NAME: 'Sammo Test',
            GIT_COMMITTER_EMAIL: 'sammo-test@example.invalid',
        },
    }).trim();

const createRepositoryFixture = (): {
    source: string;
    checkout: string;
    worktrees: string;
    firstCommit: string;
} => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sammo-workspace-manager-'));
    temporaryRoots.push(root);
    const remote = path.join(root, 'remote.git');
    const source = path.join(root, 'source');
    const checkout = path.join(root, 'checkout');
    const worktrees = path.join(root, 'worktrees');

    fs.mkdirSync(source);
    git(root, 'init', '--bare', remote);
    git(source, 'init', '-b', 'main');
    fs.writeFileSync(path.join(source, 'version.txt'), 'first\n');
    git(source, 'add', 'version.txt');
    git(source, 'commit', '-m', 'first');
    const firstCommit = git(source, 'rev-parse', 'HEAD');
    git(source, 'remote', 'add', 'origin', remote);
    git(source, 'push', '-u', 'origin', 'main');
    git(root, 'clone', '--branch', 'main', remote, checkout);
    return { source, checkout, worktrees, firstCommit };
};

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe('GitWorkspaceManager source resolution', () => {
    it('keeps COMMIT pinned while BRANCH follows the latest remote head', async () => {
        const fixture = createRepositoryFixture();
        const manager = new GitWorkspaceManager({
            repoRoot: fixture.checkout,
            worktreeRoot: fixture.worktrees,
        });

        expect(await manager.resolveCommit('COMMIT', fixture.firstCommit)).toBe(fixture.firstCommit);
        expect(await manager.resolveCommit('BRANCH', 'main')).toBe(fixture.firstCommit);

        fs.writeFileSync(path.join(fixture.source, 'version.txt'), 'second\n');
        git(fixture.source, 'add', 'version.txt');
        git(fixture.source, 'commit', '-m', 'second');
        const secondCommit = git(fixture.source, 'rev-parse', 'HEAD');
        git(fixture.source, 'push', 'origin', 'main');

        expect(await manager.resolveCommit('COMMIT', fixture.firstCommit)).toBe(fixture.firstCommit);
        expect(await manager.resolveCommit('BRANCH', 'main')).toBe(secondCommit);
    });

    it('fetches a remote commit that is not present in the controller checkout yet', async () => {
        const fixture = createRepositoryFixture();
        const manager = new GitWorkspaceManager({
            repoRoot: fixture.checkout,
            worktreeRoot: fixture.worktrees,
        });

        fs.writeFileSync(path.join(fixture.source, 'version.txt'), 'remote-only\n');
        git(fixture.source, 'add', 'version.txt');
        git(fixture.source, 'commit', '-m', 'remote only');
        const remoteCommit = git(fixture.source, 'rev-parse', 'HEAD');
        git(fixture.source, 'push', 'origin', 'main');
        expect(() => git(fixture.checkout, 'cat-file', '-e', `${remoteCommit}^{commit}`)).toThrow();

        await expect(manager.resolveCommit('COMMIT', remoteCommit)).resolves.toBe(remoteCommit);
    });

    it('rejects option-like and range refs', async () => {
        const fixture = createRepositoryFixture();
        const manager = new GitWorkspaceManager({
            repoRoot: fixture.checkout,
            worktreeRoot: fixture.worktrees,
        });

        await expect(manager.resolveCommit('BRANCH', '--upload-pack=bad')).rejects.toThrow('Invalid git ref');
        await expect(manager.resolveCommit('COMMIT', 'HEAD..main')).rejects.toThrow('Invalid git ref');
    });

    it('reuses only a clean registered worktree at the requested commit', async () => {
        const fixture = createRepositoryFixture();
        const manager = new GitWorkspaceManager({
            repoRoot: fixture.checkout,
            worktreeRoot: fixture.worktrees,
        });

        const created = await manager.prepare(fixture.firstCommit);
        expect(created.created).toBe(true);
        const reused = await manager.prepare(fixture.firstCommit);
        expect(reused).toMatchObject({ root: created.root, created: false });

        fs.writeFileSync(path.join(created.root, 'untracked.txt'), 'dirty\n');
        await expect(manager.prepare(fixture.firstCommit)).rejects.toThrow('uncommitted changes');
    });

    it('rejects an unregistered directory that occupies a commit workspace path', async () => {
        const fixture = createRepositoryFixture();
        const manager = new GitWorkspaceManager({
            repoRoot: fixture.checkout,
            worktreeRoot: fixture.worktrees,
        });
        const occupied = path.join(fixture.worktrees, fixture.firstCommit);
        fs.mkdirSync(occupied, { recursive: true });

        await expect(manager.prepare(fixture.firstCommit)).rejects.toThrow('not registered as a git worktree');
    });

    it('removes only registered direct commit workspaces and never the root or sibling prefixes', async () => {
        const fixture = createRepositoryFixture();
        const manager = new GitWorkspaceManager({
            repoRoot: fixture.checkout,
            worktreeRoot: fixture.worktrees,
        });
        const workspace = await manager.prepare(fixture.firstCommit);
        const siblingPrefix = `${fixture.worktrees}-outside`;
        fs.mkdirSync(siblingPrefix, { recursive: true });

        await expect(manager.remove(fixture.worktrees)).rejects.toThrow('must be a child');
        await expect(manager.remove(path.join(siblingPrefix, fixture.firstCommit))).rejects.toThrow('must be a child');
        expect(fs.existsSync(siblingPrefix)).toBe(true);
        await expect(manager.remove(workspace.root)).resolves.toBe(true);
        expect(fs.existsSync(workspace.root)).toBe(false);
    });

    it('rejects deletion of unregistered and nested paths under the worktree root', async () => {
        const fixture = createRepositoryFixture();
        const manager = new GitWorkspaceManager({
            repoRoot: fixture.checkout,
            worktreeRoot: fixture.worktrees,
        });
        const unregistered = path.join(fixture.worktrees, fixture.firstCommit);
        fs.mkdirSync(unregistered, { recursive: true });

        await expect(manager.remove(unregistered)).rejects.toThrow('not registered as a git worktree');
        await expect(manager.remove(path.join(unregistered, 'nested'))).rejects.toThrow(
            'not a managed commit workspace'
        );
        expect(fs.existsSync(unregistered)).toBe(true);
    });
});
