import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const materializer = path.resolve(import.meta.dirname, '../../../tools/build-scripts/materialize-profile-frontend.mjs');
const temporaryRoots: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('profile frontend materializer', () => {
    it('replaces an existing profile artifact from the cached release build', async () => {
        const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'profile-frontend-materializer-'));
        temporaryRoots.push(workspaceRoot);
        const source = path.join(workspaceRoot, 'app', 'game-frontend', '.release-build');
        const target = path.join(workspaceRoot, '.release-dist', 'che_2', 'game-frontend');
        await mkdir(source, { recursive: true });
        await mkdir(target, { recursive: true });
        await writeFile(path.join(source, 'index.html'), 'new release');
        await writeFile(path.join(target, 'index.html'), 'old release');

        await execFileAsync(process.execPath, [materializer, 'che:2'], { cwd: workspaceRoot });

        await expect(readFile(path.join(target, 'index.html'), 'utf8')).resolves.toBe('new release');
    });

    it('keeps an existing artifact untouched when the cached build is missing', async () => {
        const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'profile-frontend-materializer-'));
        temporaryRoots.push(workspaceRoot);
        const target = path.join(workspaceRoot, '.release-dist', 'che_2', 'game-frontend');
        await mkdir(target, { recursive: true });
        await writeFile(path.join(target, 'index.html'), 'old release');

        await expect(
            execFileAsync(process.execPath, [materializer, 'che:2'], { cwd: workspaceRoot })
        ).rejects.toThrow();
        await expect(readFile(path.join(target, 'index.html'), 'utf8')).resolves.toBe('old release');
    });
});
