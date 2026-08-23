import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    FrontendArtifactManager,
    GAME_FRONTEND_RUNTIME_CONFIG_ID,
    renderProfileFrontendIndex,
    resolveFrontendServeMode,
    SHARED_GAME_FRONTEND_KEY,
} from '../src/orchestrator/frontendArtifactManager.js';

const roots: string[] = [];
const sha = 'a'.repeat(40);
const cleanupNow = new Date('2026-08-23T00:00:00.000Z');

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

    it('publishes one shared asset release and a small profile runtime-config wrapper', async () => {
        const { source, artifacts } = await fixture();
        await fs.writeFile(
            path.join(source, 'index.html'),
            '<!doctype html><head><script type="module" src="./assets/app-deadbeef.js"></script></head>'
        );
        await fs.writeFile(path.join(source, 'deployment-version.json'), `${JSON.stringify({ commitSha: sha })}\n`);
        const manager = new FrontendArtifactManager(artifacts);
        const sharedArtifact = await manager.stage({
            frontendKey: SHARED_GAME_FRONTEND_KEY,
            sourceRoot: source,
            commitSha: sha,
        });
        const wrapper = await manager.stageProfileWrapper({
            frontendKey: 'pya',
            sharedArtifact,
            sharedAssetPublicBase: '/gateway/profile-assets',
            runtimeConfig: {
                version: 1,
                profile: 'pya',
                profileName: 'pya:default',
                appBasePath: '/pya/',
                gameApiUrl: '/pya/api/trpc',
                gameSseUrl: '/pya/api/events',
                gatewayApiUrl: '/gateway/api/trpc',
                gatewayWebUrl: '/gateway/',
            },
        });
        await manager.activate('pya', wrapper.releaseId);

        const indexHtml = await fs.readFile(path.join(artifacts, 'pya', 'current', 'index.html'), 'utf8');
        expect(indexHtml).toContain(`id="${GAME_FRONTEND_RUNTIME_CONFIG_ID}" type="application/json"`);
        expect(indexHtml).toContain('"profile":"pya"');
        expect(indexHtml).toContain(`"assetReleaseId":"${sharedArtifact.releaseId}"`);
        expect(indexHtml).toContain(`src="/gateway/profile-assets/${sharedArtifact.releaseId}/assets/app-deadbeef.js"`);
        expect(await fs.readdir(path.join(artifacts, 'pya', 'current'))).toEqual([
            '.sammo-artifact.json',
            'deployment-version.json',
            'index.html',
        ]);
        expect(await fs.readFile(path.join(sharedArtifact.releasePath, 'assets', 'app-deadbeef.js'), 'utf8')).toBe(
            'console.log(1)'
        );
    });

    it('escapes script-closing runtime values before embedding JSON', () => {
        const releaseId = `${sha}-${'b'.repeat(16)}`;
        const rendered = renderProfileFrontendIndex({
            sharedIndexHtml: '<script type="module" src="./assets/app-deadbeef.js"></script>',
            sharedReleaseId: releaseId,
            sharedAssetPublicBase: '/gateway/profile-assets',
            runtimeConfig: {
                version: 1,
                profile: 'che',
                profileName: 'che:default',
                appBasePath: '/che/',
                gameApiUrl: '/che/api/trpc?</script>',
                gameSseUrl: '/che/api/events',
                gatewayApiUrl: '/gateway/api/trpc',
                gatewayWebUrl: '/gateway/',
                buildCommitSha: sha,
                assetReleaseId: releaseId,
            },
        });

        expect(rendered).not.toContain('trpc?</script>');
        expect(rendered).toContain('\\u003c/script\\u003e');
    });

    it('removes only expired unreferenced releases while preserving pointers, active commits, grace, and caches', async () => {
        const { source, artifacts } = await fixture();
        const manager = new FrontendArtifactManager(artifacts);
        const stage = async (marker: string, commitMarker: string) => {
            await fs.writeFile(path.join(source, 'index.html'), `<div>${marker}</div>`);
            return manager.stage({
                frontendKey: 'gateway',
                sourceRoot: source,
                commitSha: commitMarker.repeat(40),
            });
        };
        const current = await stage('current', '1');
        await manager.activate('gateway', current.releaseId);
        const next = await stage('next', '2');
        await manager.activate('gateway', next.releaseId);
        const pinned = await stage('pinned', '3');
        const recent = await stage('recent', '4');
        const cached = await stage('cached', '5');
        const stale = await stage('stale', '6');
        const releasesRoot = path.join(artifacts, 'gateway', 'releases');
        const staging = path.join(releasesRoot, '.staging-00000000-0000-0000-0000-000000000000');
        const unknownSymlink = path.join(releasesRoot, `${'7'.repeat(40)}-${'7'.repeat(16)}`);
        await fs.mkdir(staging);
        await fs.symlink(stale.releasePath, unknownSymlink);
        const old = new Date(cleanupNow.getTime() - 72 * 60 * 60 * 1_000);
        for (const artifact of [current, next, pinned, cached, stale]) {
            await fs.utimes(artifact.releasePath, old, old);
        }
        await fs.utimes(cached.releasePath, new Date(old.getTime() + 1_000), new Date(old.getTime() + 1_000));
        await fs.utimes(staging, old, old);
        const recentAt = new Date(cleanupNow.getTime() - 60 * 60 * 1_000);
        await fs.utimes(recent.releasePath, recentAt, recentAt);

        const result = await manager.cleanup({
            frontendKeys: ['gateway'],
            protectedCommitShas: [pinned.manifest.commitSha],
            retentionMs: 24 * 60 * 60 * 1_000,
            keepNewest: 2,
            now: cleanupNow,
        });

        expect(result.removed.sort()).toEqual([staging, stale.releasePath].sort());
        expect(result.retained).toEqual(
            expect.arrayContaining([
                current.releasePath,
                next.releasePath,
                pinned.releasePath,
                recent.releasePath,
                cached.releasePath,
            ])
        );
        expect(result.skipped).toContain(unknownSymlink);
        await expect(fs.access(stale.releasePath)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.readFile(path.join(artifacts, 'gateway', 'current', 'index.html'), 'utf8')).resolves.toContain(
            'next'
        );
        await expect(fs.readFile(path.join(artifacts, 'gateway', 'previous', 'index.html'), 'utf8')).resolves.toContain(
            'current'
        );
    });

    it('preserves shared assets referenced by current and previous profile wrappers, including old manifests', async () => {
        const { source, artifacts } = await fixture();
        await fs.writeFile(
            path.join(source, 'index.html'),
            '<!doctype html><head><script type="module" src="./assets/app-deadbeef.js"></script></head>'
        );
        await fs.writeFile(path.join(source, 'deployment-version.json'), `${JSON.stringify({ commitSha: sha })}\n`);
        const manager = new FrontendArtifactManager(artifacts);
        const publish = async (commitMarker: string, script: string) => {
            const commitSha = commitMarker.repeat(40);
            await fs.writeFile(path.join(source, 'assets', 'app-deadbeef.js'), script);
            await fs.writeFile(path.join(source, 'deployment-version.json'), `${JSON.stringify({ commitSha })}\n`);
            const shared = await manager.stage({
                frontendKey: SHARED_GAME_FRONTEND_KEY,
                sourceRoot: source,
                commitSha,
            });
            const wrapper = await manager.stageProfileWrapper({
                frontendKey: 'pya',
                sharedArtifact: shared,
                sharedAssetPublicBase: '/gateway/profile-assets',
                runtimeConfig: {
                    version: 1,
                    profile: 'pya',
                    profileName: 'pya:default',
                    appBasePath: '/pya/',
                    gameApiUrl: '/pya/api/trpc',
                    gameSseUrl: '/pya/api/events',
                    gatewayApiUrl: '/gateway/api/trpc',
                    gatewayWebUrl: '/gateway/',
                },
            });
            await manager.activate('pya', wrapper.releaseId);
            return { shared, wrapper };
        };
        const first = await publish('1', 'console.log(1)');
        const second = await publish('2', 'console.log(2)');
        await fs.writeFile(path.join(source, 'assets', 'app-deadbeef.js'), 'console.log(3)');
        const unused = await manager.stage({
            frontendKey: SHARED_GAME_FRONTEND_KEY,
            sourceRoot: source,
            commitSha: '3'.repeat(40),
        });
        const firstManifestPath = path.join(first.wrapper.releasePath, '.sammo-artifact.json');
        const firstManifest = JSON.parse(await fs.readFile(firstManifestPath, 'utf8')) as Record<string, unknown>;
        delete firstManifest.dependencies;
        await fs.writeFile(firstManifestPath, `${JSON.stringify(firstManifest, null, 2)}\n`);
        const old = new Date(cleanupNow.getTime() - 72 * 60 * 60 * 1_000);
        for (const artifact of [first.shared, first.wrapper, second.shared, second.wrapper, unused]) {
            await fs.utimes(artifact.releasePath, old, old);
        }

        const result = await manager.cleanup({
            frontendKeys: ['pya', SHARED_GAME_FRONTEND_KEY],
            retentionMs: 24 * 60 * 60 * 1_000,
            keepNewest: 0,
            now: cleanupNow,
        });

        expect(result.removed).toEqual([unused.releasePath]);
        expect(result.retained).toEqual(
            expect.arrayContaining([
                first.shared.releasePath,
                first.wrapper.releasePath,
                second.shared.releasePath,
                second.wrapper.releasePath,
            ])
        );
        await expect(
            fs.readFile(path.join(first.shared.releasePath, 'assets', 'app-deadbeef.js'), 'utf8')
        ).resolves.toBe('console.log(1)');
        await expect(
            fs.readFile(path.join(second.shared.releasePath, 'assets', 'app-deadbeef.js'), 'utf8')
        ).resolves.toBe('console.log(2)');
    });

    it('fails closed when a live pointer cannot be validated', async () => {
        const { source, artifacts } = await fixture();
        const manager = new FrontendArtifactManager(artifacts);
        const stale = await manager.stage({ frontendKey: 'gateway', sourceRoot: source, commitSha: sha });
        const old = new Date(cleanupNow.getTime() - 72 * 60 * 60 * 1_000);
        await fs.utimes(stale.releasePath, old, old);
        await fs.mkdir(path.join(artifacts, 'gateway'), { recursive: true });
        await fs.symlink(`releases/${'f'.repeat(40)}-${'f'.repeat(16)}`, path.join(artifacts, 'gateway', 'current'));

        const result = await manager.cleanup({
            frontendKeys: ['gateway'],
            retentionMs: 24 * 60 * 60 * 1_000,
            keepNewest: 0,
            now: cleanupNow,
        });

        expect(result.removed).toEqual([]);
        expect(result.skipped).toEqual([path.join(artifacts, 'gateway')]);
        await expect(fs.access(stale.releasePath)).resolves.toBeUndefined();
    });
});
