import path from 'node:path';

import type { GatewayPrisma } from '@sammo-ts/infra';

import type { GatewayProfileRecord, GatewaySourceMode } from './profileRepository.js';
import type { WorkspaceInfo } from './workspaceManager.js';

export interface ProfileReleaseSource {
    mode: GatewaySourceMode;
    ref: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const readProfileReleaseSource = (profile: GatewayProfileRecord): ProfileReleaseSource | null => {
    const stored = isRecord(profile.meta) && isRecord(profile.meta.releaseSource) ? profile.meta.releaseSource : null;
    const mode = stored?.mode;
    const ref = typeof stored?.ref === 'string' ? stored.ref.trim() : '';
    if ((mode === 'BRANCH' || mode === 'COMMIT') && ref) {
        return { mode, ref };
    }
    const activeCommit = profile.buildCommitSha?.trim();
    return activeCommit ? { mode: 'COMMIT', ref: activeCommit } : null;
};

export const writeProfileReleaseSource = (
    meta: GatewayPrisma.JsonObject,
    source: ProfileReleaseSource
): GatewayPrisma.JsonObject => ({
    ...meta,
    releaseSource: {
        mode: source.mode,
        ref: source.ref,
    },
});

export const canReuseActiveProfileWorkspace = (
    profile: GatewayProfileRecord | undefined,
    commitSha: string,
    workspace: WorkspaceInfo
): boolean =>
    profile?.buildCommitSha === commitSha &&
    typeof profile.buildWorkspace === 'string' &&
    path.resolve(profile.buildWorkspace) === path.resolve(workspace.root) &&
    !workspace.needsInstall;
