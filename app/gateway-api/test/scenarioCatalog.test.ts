import { describe, expect, it } from 'vitest';

import {
    hasProfileReleaseBuildTasks,
    listScenarioPreviews,
    resolveGitCommitSha,
    supportsProfileReleaseBuild,
} from '../src/scenario/scenarioCatalog.js';

describe('scenarioCatalog git ref support', () => {
    it('rejects a pinned release whose frontend predates the current build contract', async () => {
        expect(hasProfileReleaseBuildTasks({ tasks: { build: {} } }, { scripts: { build: 'vite build' } })).toBe(
            false
        );
        expect(await supportsProfileReleaseBuild('HEAD')).toBe(true);
    });
    it.each([undefined, 'HEAD'])('publishes resolved start years for every scenario (%s)', async (gitRef) => {
        const previews = await listScenarioPreviews({ gitRef });
        expect(previews.every((scenario) => Number.isFinite(scenario.year))).toBe(true);
        expect(previews.find((scenario) => scenario.id === 2020)?.year).toBe(180);
        expect(previews.find((scenario) => scenario.id === 1031)?.year).toBe(192);
        expect(previews.find((scenario) => scenario.id === 915)?.year).toBe(180);
    });

    it('includes the CHE zero-season dawn scenario in the local catalog', async () => {
        const previews = await listScenarioPreviews();

        expect(previews.find((scenario) => scenario.id === 916)).toMatchObject({
            id: 916,
            title: '【공백지】 여명',
            year: 180,
        });
    });

    it('resolves HEAD to a commit hash', async () => {
        const commitSha = await resolveGitCommitSha('HEAD');
        expect(commitSha).toMatch(/^[0-9a-f]{40}$/i);
    });

    it('loads scenario previews from a git ref', async () => {
        const previews = await listScenarioPreviews({ gitRef: 'HEAD' });
        expect(previews.length).toBeGreaterThan(0);
        const ids = previews.map((scenario) => scenario.id);
        const sorted = [...ids].sort((a, b) => a - b);
        expect(ids).toEqual(sorted);
        expect(previews.every((scenario) => scenario.defaultStatTotal > 0)).toBe(true);
        expect(previews.every((scenario) => scenario.fiction === null || Number.isInteger(scenario.fiction))).toBe(
            true
        );
        expect(previews.find((scenario) => scenario.id === 916)).toMatchObject({
            id: 916,
            title: '【공백지】 여명',
            year: 180,
        });
    });

    it('rejects without crashing when git cannot be spawned', async () => {
        const originalPath = process.env.PATH;
        process.env.PATH = '/nonexistent';
        try {
            await expect(resolveGitCommitSha('HEAD')).rejects.toThrow('git ref not found.');
        } finally {
            process.env.PATH = originalPath;
        }
    });
});
