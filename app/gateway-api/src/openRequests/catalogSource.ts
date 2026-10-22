import { TRPCError } from '@trpc/server';
import type { GatewayProfileRecord } from '../orchestrator/profileRepository.js';
import { readProfileReleaseSource } from '../orchestrator/profileReleaseSource.js';
import { resolveGitBranchCommitSha, resolveGitCommitSha } from '../scenario/scenarioCatalog.js';

// 이미 배포된 서버는 그 catalog를 보존하고, 첫 오픈 전 서버만 운영자가 정한 source를 사용한다.
// 일반 사용자는 이 조회에도 branch/commit을 전달할 수 없다.
export const resolveOpeningCatalogCommit = async (
    profile: Pick<GatewayProfileRecord, 'meta' | 'buildCommitSha'>
): Promise<string> => {
    if (profile.buildCommitSha?.trim()) return profile.buildCommitSha.trim();
    const source = readProfileReleaseSource(profile);
    if (!source) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '서버의 배포 버전 또는 패치 정책이 필요합니다.' });
    }
    try {
        return source.mode === 'BRANCH'
            ? await resolveGitBranchCommitSha(source.ref)
            : await resolveGitCommitSha(source.ref);
    } catch {
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: '서버 패치 정책의 시나리오 버전을 확인하지 못했습니다.',
        });
    }
};
