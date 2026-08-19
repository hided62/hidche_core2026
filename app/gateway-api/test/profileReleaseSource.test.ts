import { describe, expect, it } from 'vitest';

import {
    canReuseActiveProfileWorkspace,
    readProfileReleaseSource,
    writeProfileReleaseSource,
} from '../src/orchestrator/profileReleaseSource.js';
import type { GatewayProfileRecord } from '../src/orchestrator/profileRepository.js';

const profile = (overrides: Partial<GatewayProfileRecord> = {}): GatewayProfileRecord => ({
    profileName: 'che:2',
    profile: 'che',
    instanceKey: '2',
    currentScenario: '1010',
    scenario: '1010',
    apiPort: 15003,
    status: 'RUNNING',
    buildStatus: 'SUCCEEDED',
    buildCommitSha: 'a'.repeat(40),
    buildWorkspace: `/srv/sammo/worktrees/${'a'.repeat(40)}`,
    meta: {},
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
});

describe('profile release source policy', () => {
    it('follows the stored branch instead of pinning the active commit', () => {
        const current = profile({ meta: { releaseSource: { mode: 'BRANCH', ref: 'main' } } });
        expect(readProfileReleaseSource(current)).toEqual({ mode: 'BRANCH', ref: 'main' });
    });

    it('falls back to the active commit for profiles without a stored policy', () => {
        expect(readProfileReleaseSource(profile())).toEqual({ mode: 'COMMIT', ref: 'a'.repeat(40) });
    });

    it('preserves unrelated metadata while changing the privileged release policy', () => {
        expect(writeProfileReleaseSource({ nextSeasonIdx: 3 }, { mode: 'COMMIT', ref: 'b'.repeat(40) })).toEqual({
            nextSeasonIdx: 3,
            releaseSource: { mode: 'COMMIT', ref: 'b'.repeat(40) },
        });
    });

    it('reuses installed artifacts only for the same active commit and workspace', () => {
        const current = profile();
        expect(
            canReuseActiveProfileWorkspace(current, 'a'.repeat(40), {
                root: current.buildWorkspace!,
                created: false,
                needsInstall: false,
            })
        ).toBe(true);
        expect(
            canReuseActiveProfileWorkspace(current, 'b'.repeat(40), {
                root: current.buildWorkspace!,
                created: false,
                needsInstall: false,
            })
        ).toBe(false);
        expect(
            canReuseActiveProfileWorkspace(current, 'a'.repeat(40), {
                root: current.buildWorkspace!,
                created: false,
                needsInstall: true,
            })
        ).toBe(false);
    });
});
