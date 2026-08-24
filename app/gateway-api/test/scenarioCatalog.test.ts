import { describe, expect, it } from 'vitest';

import { listScenarioPreviews, resolveGitCommitSha } from '../src/scenario/scenarioCatalog.js';

describe('scenarioCatalog git ref support', () => {
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
