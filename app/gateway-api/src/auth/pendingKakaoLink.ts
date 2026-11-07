import { TRPCError } from '@trpc/server';
import type { GatewayApiContext } from '../context.js';
import type { OAuthSession } from './oauthSessionStore.js';
import type { UserRecord } from './userRepository.js';
import { assertLoginAllowed, completeGatewayLogin } from './deletionRecovery.js';
import { authorizeKakaoLink, snapshotKakaoLink } from './kakaoLinkPolicy.js';
import { KakaoVerificationError, readVerifiedKakaoProfile, requireKakaoTalkProof } from './kakaoAccountVerification.js';
import { openPassword } from './registrationInput.js';

const LINK_TTL_MS = 300_000;
const firstUserId = async (ctx: GatewayApiContext): Promise<string | undefined> =>
    (await ctx.prisma.appUser.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;

export const validatePendingKakaoProfile = async (ctx: GatewayApiContext, session: OAuthSession): Promise<void> => {
    const createdAt = Date.parse(session.createdAt);
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > LINK_TTL_MS || createdAt > Date.now()) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: '카카오 연결 확인이 만료되었습니다. 카카오 로그인을 다시 진행해 주세요.',
        });
    }
    const profile = await ctx.kakaoClient
        .getMe(session.accessToken)
        .then(readVerifiedKakaoProfile)
        .catch((error: unknown) => {
            if (error instanceof KakaoVerificationError)
                throw new TRPCError({ code: 'UNAUTHORIZED', message: error.message, cause: error });
            throw error;
        });
    if (profile.kakaoId !== session.kakaoId || profile.email !== session.email.toLowerCase()) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: '카카오 계정 정보가 변경되었습니다. 처음부터 다시 진행해 주세요.',
        });
    }
};

export const requestPendingKakaoOtp = async (ctx: GatewayApiContext, session: OAuthSession, user: UserRecord) => {
    assertLoginAllowed(user);
    const challenge = await requireKakaoTalkProof({
        user,
        accessToken: session.accessToken,
        kakaoClient: ctx.kakaoClient,
        oauthSessions: ctx.oauthSessions,
        publicBaseUrl: ctx.publicBaseUrl,
        oauthSessionId: session.id,
    }).catch((error: unknown) => {
        if (error instanceof KakaoVerificationError)
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message, cause: error });
        throw error;
    });
    if (!challenge) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    return { ...challenge, successStatus: session.mode === 'verify' ? ('verified' as const) : ('login' as const) };
};

export const beginPendingKakaoLink = async (
    ctx: GatewayApiContext,
    user: UserRecord,
    oauth: OAuthSession,
    passwordVerified = false
) => {
    await validatePendingKakaoProfile(ctx, oauth);
    assertLoginAllowed(user);
    const authorization = authorizeKakaoLink(user, oauth.email, passwordVerified, await firstUserId(ctx));
    const [owner, detached] = await Promise.all([
        ctx.users.findByOauthId('KAKAO', oauth.kakaoId),
        ctx.users.findDetachedKakaoOwner(oauth.kakaoId),
    ]);
    if (
        (owner && owner.id !== user.id) ||
        (detached && detached !== user.id) ||
        (await ctx.users.isKakaoIdentityRetired(oauth.kakaoId))
    ) {
        throw new TRPCError({
            code: 'CONFLICT',
            message: '다른 계정에 귀속된 카카오 계정입니다. 관리자에게 문의해 주세요.',
        });
    }
    const session = await ctx.oauthSessions.createSession({
        ...oauth,
        intent: 'identity_link',
        targetUserId: user.id,
        createdAt: new Date().toISOString(),
        identityLink: { expected: snapshotKakaoLink(user), authorization },
    });
    if (user.passwordResetRequired) {
        return {
            status: 'password_setup' as const,
            oauthSessionId: session.id,
            email: session.email,
            successStatus: session.mode === 'verify' ? ('verified' as const) : ('login' as const),
        };
    }
    return requestPendingKakaoOtp(ctx, session, user);
};

export const finishPendingKakaoLink = async (
    ctx: GatewayApiContext,
    sessionId: string,
    userId: string,
    validUntil: string
) => {
    const pending = await ctx.oauthSessions.consumeSession(sessionId);
    if (!pending || pending.intent !== 'identity_link' || !pending.identityLink || pending.targetUserId !== userId) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: '카카오 연결 확인이 만료되었습니다. 다시 로그인해 주세요.',
        });
    }
    await validatePendingKakaoProfile(ctx, pending);
    let user: UserRecord;
    try {
        user = await ctx.users.completeKakaoIdentityLink(userId, {
            ...pending.identityLink,
            oauthId: pending.kakaoId,
            email: pending.email,
            oauthInfo: {
                accessToken: pending.accessToken,
                refreshToken: pending.refreshToken,
                accessTokenValidUntil: pending.accessTokenValidUntil,
                refreshTokenValidUntil: pending.refreshTokenValidUntil,
            },
            verifiedAt: new Date(),
            talkVerifiedUntil: new Date(validUntil),
            firstUserId: await firstUserId(ctx),
            ...(pending.identityLink.credential
                ? { password: openPassword(ctx.passwordEnvelope, pending.identityLink.credential) }
                : {}),
        });
    } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
            code: 'CONFLICT',
            message: '계정 연결 상태가 변경되었습니다. 카카오 로그인을 다시 진행해 주세요.',
            cause: error,
        });
    }
    try {
        await ctx.flushPublisher.publishUserFlush(user.id, 'kakao-account-relinked');
    } catch {
        // DB의 인증 revision은 이미 증가했다. 다음 접속의 재검증을 유지하고 저장 성공을 반환한다.
    }
    return { ...(await completeGatewayLogin(ctx, user, 'login')), validUntil };
};
