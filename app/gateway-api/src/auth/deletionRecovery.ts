import { TRPCError } from '@trpc/server';
import { isLoginBanned } from '@sammo-ts/common/auth/sanctions';

import type { GatewayApiContext } from '../context.js';
import { toPublicUser, type UserRecord } from './userRepository.js';

// 이전 서비스의 장기 보존 탈퇴 계정만 복구한다. 날짜는 한국 시간 기준이다.
export const LEGACY_DELETION_RECOVERY_CUTOFF = new Date('2026-07-01T00:00:00+09:00');

export const canCancelDeletion = (user: UserRecord, now = new Date()): boolean => {
    if (!user.deleteAfter) return false;
    const deadline = new Date(user.deleteAfter).getTime();
    return (
        Number.isFinite(deadline) &&
        (deadline > now.getTime() ||
            (Number.isSafeInteger(user.legacyMemberNo) &&
                (user.legacyMemberNo ?? 0) > 0 &&
                deadline - 30 * 24 * 60 * 60 * 1000 < LEGACY_DELETION_RECOVERY_CUTOFF.getTime()))
    );
};

export const assertLoginAllowed = (user: UserRecord): void => {
    if (isLoginBanned(user.sanctions)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Account login is blocked.' });
    }
    if (user.deleteAfter && !canCancelDeletion(user)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '계정 보존 기간이 지나 탈퇴를 취소할 수 없습니다.' });
    }
};

export const completeGatewayLogin = async <T extends 'login' | 'verified'>(
    ctx: GatewayApiContext,
    user: UserRecord,
    status: T
) => {
    assertLoginAllowed(user);
    if (user.deleteAfter) {
        // 비밀번호와 필요한 Kakao/OTP 검증을 모두 마친 뒤에만, 접근 권한 없는 일회용 증명을 발급한다.
        const recovery = await ctx.oauthSessions.createDeletionRecovery({
            userId: user.id,
            deleteAfter: user.deleteAfter,
            authRevision: user.authRevision ?? 0,
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
        });
        return { status: 'deletion_pending' as const, recoveryId: recovery.id, deleteAfter: user.deleteAfter };
    }
    const session = await ctx.sessions.createSession(user);
    return { status, user: toPublicUser(user), sessionToken: session.sessionToken, issuedAt: session.issuedAt };
};
