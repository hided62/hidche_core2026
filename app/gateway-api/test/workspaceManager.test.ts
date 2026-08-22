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

    it('atomically publishes only refs below the managed release namespace', async () => {
        const fixture = createRepositoryFixture();
        const manager = new GitWorkspaceManager({
            repoRoot: fixture.checkout,
            worktreeRoot: fixture.worktrees,
        });
        const releaseRef = 'refs/sammo/active-gateway';

        await expect(manager.readPersistentReleaseRef(releaseRef)).resolves.toBeNull();
        await manager.compareAndSwapPersistentReleaseRef(releaseRef, null, fixture.firstCommit);
        await expect(manager.readPersistentReleaseRef(releaseRef)).resolves.toBe(fixture.firstCommit);
        await expect(
            manager.compareAndSwapPersistentReleaseRef(releaseRef, 'f'.repeat(40), fixture.firstCommit)
        ).rejects.toThrow(/Failed to update persistent release ref/u);
        await manager.compareAndSwapPersistentReleaseRef(releaseRef, fixture.firstCommit, null);
        await expect(manager.readPersistentReleaseRef(releaseRef)).resolves.toBeNull();
        await expect(manager.readPersistentReleaseRef('refs/heads/main')).rejects.toThrow(/refs\/sammo/u);
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

    it('cleans only expired unprotected worktrees beyond the newest cache and preserves dirty work', async () => {
        const fixture = createRepositoryFixture();
        const now = new Date('2026-08-20T12:00:00.000Z');
        const manager = new GitWorkspaceManager({
            repoRoot: fixture.checkout,
            worktreeRoot: fixture.worktrees,
            now: () => now,
        });
        const workspaces = [await manager.prepare(fixture.firstCommit)];
        for (let index = 2; index <= 5; index += 1) {
            fs.writeFileSync(path.join(fixture.source, 'version.txt'), `version ${index}\n`);
            git(fixture.source, 'add', 'version.txt');
            git(fixture.source, 'commit', '-m', `version ${index}`);
            git(fixture.source, 'push', 'origin', 'main');
            const commit = await manager.resolveCommit('BRANCH', 'main');
            workspaces.push(await manager.prepare(commit));
        }
        const expired = new Date('2026-08-01T00:00:00.000Z');
        for (const workspace of workspaces) fs.utimesSync(workspace.root, expired, expired);
        fs.writeFileSync(path.join(workspaces[1]!.root, 'preserve-me.txt'), 'uncommitted\n');
        fs.utimesSync(workspaces[1]!.root, expired, expired);
        const recent = new Date('2026-08-20T11:00:00.000Z');
        fs.utimesSync(workspaces[4]!.root, recent, recent);

        const result = await manager.cleanup({
            protectedPaths: [workspaces[0]!.root],
            retentionMs: 24 * 60 * 60 * 1_000,
            keepNewest: 1,
        });
        expect(result.removed).toHaveLength(2);
        expect(result.removed).toEqual(expect.arrayContaining([workspaces[2]!.root, workspaces[3]!.root]));
        expect(result.skipped).toHaveLength(3);
        expect(result.skipped).toEqual(
            expect.arrayContaining([workspaces[0]!.root, workspaces[1]!.root, workspaces[4]!.root])
        );
        expect(fs.existsSync(workspaces[0]!.root)).toBe(true);
        expect(fs.existsSync(workspaces[1]!.root)).toBe(true);
        expect(fs.existsSync(workspaces[2]!.root)).toBe(false);
        expect(fs.existsSync(workspaces[3]!.root)).toBe(false);
        expect(fs.existsSync(workspaces[4]!.root)).toBe(true);
    });
});
