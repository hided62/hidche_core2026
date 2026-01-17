import { describe, expect, it } from 'vitest';

import { listScenarioPreviews, resolveGitCommitSha } from '../src/scenario/scenarioCatalog.js';

describe('scenarioCatalog git ref support', () => {
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
    });
});
