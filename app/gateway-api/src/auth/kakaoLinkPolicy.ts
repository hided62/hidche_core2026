import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import type { UserRecord } from './userRepository.js';

export type KakaoLinkAuthorization = 'EMAIL' | 'PASSWORD' | 'ADMIN';
export interface KakaoLinkSnapshot {
    authRevision: number;
    oauthType: UserRecord['oauthType'];
    oauthId?: string;
    email?: string;
    passwordFingerprint: string;
}
export const snapshotKakaoLink = (user: UserRecord): KakaoLinkSnapshot => ({
    authRevision: user.authRevision ?? 0,
    oauthType: user.oauthType,
    oauthId: user.oauthId,
    email: user.email,
    passwordFingerprint: createHash('sha256').update(user.passwordHash).digest('hex'),
});
export const matchesKakaoLinkSnapshot = (user: UserRecord, expected: KakaoLinkSnapshot): boolean =>
    (user.authRevision ?? 0) === expected.authRevision &&
    user.oauthType === expected.oauthType &&
    user.oauthId === expected.oauthId &&
    user.email === expected.email &&
    createHash('sha256').update(user.passwordHash).digest('hex') === expected.passwordFingerprint;

export const authorizeKakaoLink = (
    user: UserRecord,
    email: string,
    passwordVerified: boolean,
    firstUserId: string | undefined,
    now = new Date()
): KakaoLinkAuthorization => {
    const privileged =
        user.id === firstUserId ||
        user.roles.some((role) => role === 'superuser' || role === 'admin' || role.startsWith('admin.'));
    const approved = Boolean(
        user.kakaoReplacementApprovedByUserId &&
        user.kakaoReplacementReason &&
        user.kakaoReplacementApprovedUntil &&
        new Date(user.kakaoReplacementApprovedUntil) > now
    );
    if (privileged && user.oauthType === 'KAKAO' && user.oauthId) {
        if (approved) return 'ADMIN';
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: '관리자 계정의 카카오 교체에는 관리자 승인이 필요합니다.',
        });
    }
    if (passwordVerified) return 'PASSWORD';
    if (privileged)
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: '관리자 계정의 최초 카카오 연결은 기존 비밀번호를 확인해야 합니다.',
        });
    if (!privileged && user.email?.toLowerCase() === email.toLowerCase()) return 'EMAIL';
    if (approved) return 'ADMIN';
    throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '이메일이 다른 계정은 기존 비밀번호로 확인하거나 관리자에게 복구를 요청해 주세요.',
    });
};
