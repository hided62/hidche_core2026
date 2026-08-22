import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FrontendArtifactManager, resolveFrontendServeMode } from '../src/orchestrator/frontendArtifactManager.js';

const roots: string[] = [];
const sha = 'a'.repeat(40);

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const fixture = async (): Promise<{ source: string; artifacts: string }> => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-frontend-artifact-'));
    roots.push(root);
    const source = path.join(root, 'dist');
    const artifacts = path.join(root, 'artifacts');
    await fs.mkdir(path.join(source, 'assets'), { recursive: true });
    await fs.writeFile(path.join(source, 'index.html'), '<div>one</div>');
    await fs.writeFile(path.join(source, 'assets', 'app-deadbeef.js'), 'console.log(1)');
    return { source, artifacts };
};

describe('resolveFrontendServeMode', () => {
    it('keeps preview as the compatibility default and accepts explicit static mode', () => {
        expect(resolveFrontendServeMode(undefined)).toBe('preview');
        expect(resolveFrontendServeMode('preview')).toBe('preview');
        expect(resolveFrontendServeMode('STATIC')).toBe('static');
        expect(() => resolveFrontendServeMode('server')).toThrow(/preview or static/u);
    });
});

describe('FrontendArtifactManager', () => {
    it('stages immutable releases and atomically switches current and previous pointers', async () => {
        const { source, artifacts } = await fixture();
        const manager = new FrontendArtifactManager(artifacts);
        const first = await manager.stageAndActivate({ frontendKey: 'gateway', sourceRoot: source, commitSha: sha });
        expect(await manager.readCurrentReleaseId('gateway')).toBe(first.releaseId);
        expect(await fs.readFile(path.join(artifacts, 'gateway', 'current', 'index.html'), 'utf8')).toContain('one');

        await fs.writeFile(path.join(source, 'index.html'), '<div>two</div>');
        const second = await manager.stageAndActivate({
            frontendKey: 'gateway',
            sourceRoot: source,
            commitSha: 'b'.repeat(40),
        });
        expect(second.previousReleaseId).toBe(first.releaseId);
        expect(await fs.readFile(path.join(artifacts, 'gateway', 'current', 'index.html'), 'utf8')).toContain('two');
        expect(await fs.readFile(path.join(artifacts, 'gateway', 'previous', 'index.html'), 'utf8')).toContain('one');
        expect(await fs.readFile(path.join(first.releasePath, 'index.html'), 'utf8')).toContain('one');
    });

    it('removes only the live pointer when a frontend is stopped', async () => {
        const { source, artifacts } = await fixture();
        const manager = new FrontendArtifactManager(artifacts);
        const staged = await manager.stageAndActivate({ frontendKey: 'che', sourceRoot: source, commitSha: sha });
        expect(await manager.deactivate('che')).toBe(staged.releaseId);
        expect(await manager.readCurrentReleaseId('che')).toBeNull();
        expect(await fs.readFile(path.join(staged.releasePath, 'index.html'), 'utf8')).toContain('one');
    });

    it('rejects symlinks instead of copying files outside the build output', async () => {
        const { source, artifacts } = await fixture();
        await fs.symlink('/etc/passwd', path.join(source, 'assets', 'outside'));
        const manager = new FrontendArtifactManager(artifacts);
        await expect(manager.stage({ frontendKey: 'gateway', sourceRoot: source, commitSha: sha })).rejects.toThrow(
            /symbolic link/u
        );
    });
});
