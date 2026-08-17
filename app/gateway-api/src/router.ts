import { randomBytes } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { addHours, addSeconds, isAfter, isValid, parseISO } from 'date-fns';
import { z } from 'zod';

import { decryptGameSessionToken, encryptGameSessionToken } from '@sammo-ts/common/auth/gameToken';
import { isGameAccessBlocked, isLoginBanned } from '@sammo-ts/common/auth/sanctions';

import { procedure, router } from './trpc.js';
import { toPublicUser } from './auth/userRepository.js';
import type { UserOAuthInfo, UserRecord } from './auth/userRepository.js';
import { adminRouter } from './adminRouter.js';
import { accountRouter } from './account/router.js';
import {
    hasActiveSpecialAccountGrant,
    hasOperatorSpecialAccess,
    resolveLocalAccountProfilePolicy,
} from './auth/localAccountPolicy.js';
import { openPassword, zDisplayName, zPasswordEnvelope, zRegistrationUsername } from './auth/registrationInput.js';
import { resolveEffectiveAccountIcon } from './auth/accountIconProjection.js';
import { purifyGatewayNoticeHtml } from './security/gatewayNoticeHtml.js';
import type { GatewayApiContext } from './context.js';
import {
    KakaoVerificationError,
    mergeRequiredKakaoScopes,
    oauthInfoFromToken,
    readVerifiedKakaoProfile,
    requireKakaoTalkProof,
    verifyKakaoTalkChallenge,
    verifyStoredKakaoIdentity,
} from './auth/kakaoAccountVerification.js';

const zUsername = z
    .string()
    .min(2)
    .max(64)
    .transform((value) => value.trim().toLocaleLowerCase('en-US'));
const zPassword = z.string().min(6).max(128);
const zProfile = z.string().min(1).max(64);
const zOAuthMode = z.enum(['login', 'change_pw', 'verify']);
const zKakaoRecoveryAction = z.enum(['link_existing', 'rejoin']);
const zBootstrapToken = z.string().min(1);

const parseDate = (value: string): Date | null => {
    const parsed = parseISO(value);
    return isValid(parsed) ? parsed : null;
};

const throwKakaoVerificationError = (error: unknown): never => {
    if (!(error instanceof KakaoVerificationError)) {
        throw error;
    }
    const code =
        error.verificationCode === 'EMAIL_CONFLICT'
            ? 'CONFLICT'
            : error.verificationCode === 'IDENTITY_MISMATCH'
              ? 'UNAUTHORIZED'
              : error.verificationCode === 'EMAIL_REQUIRED' || error.verificationCode === 'EMAIL_UNVERIFIED'
                ? 'BAD_REQUEST'
                : 'PRECONDITION_FAILED';
    throw new TRPCError({ code, message: error.message, cause: error });
};

const finishKakaoLogin = async <T extends 'login' | 'verified'>(
    ctx: GatewayApiContext,
    user: UserRecord,
    accessToken: string,
    successStatus: T
) => {
    try {
        const challenge = await requireKakaoTalkProof({
            user,
            accessToken,
            kakaoClient: ctx.kakaoClient,
            oauthSessions: ctx.oauthSessions,
            publicBaseUrl: ctx.publicBaseUrl,
        });
        if (challenge) {
            return { ...challenge, successStatus };
        }
    } catch (error) {
        throwKakaoVerificationError(error);
    }
    const session = await ctx.sessions.createSession(user);
    return {
        status: successStatus,
        user: toPublicUser(user),
        sessionToken: session.sessionToken,
        issuedAt: session.issuedAt,
    };
};

const finishKakaoLoginOrRequestPasswordSetup = async <T extends 'login' | 'verified'>(
    ctx: GatewayApiContext,
    user: UserRecord,
    accessToken: string,
    successStatus: T
) => {
    if (!user.passwordResetRequired) {
        return finishKakaoLogin(ctx, user, accessToken, successStatus);
    }
    if (user.oauthType !== 'KAKAO' || !user.oauthId || !user.email) {
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: '카카오 계정 연결 정보가 올바르지 않아 비밀번호를 설정할 수 없습니다.',
        });
    }
    const oauthInfo = user.oauthInfo ?? {};
    const passwordSetup = await ctx.oauthSessions.createSession({
        mode: successStatus === 'verified' ? 'verify' : 'login',
        intent: 'password_setup',
        targetUserId: user.id,
        kakaoId: user.oauthId,
        email: user.email,
        accessToken,
        refreshToken: oauthInfo.refreshToken,
        accessTokenValidUntil: oauthInfo.accessTokenValidUntil ?? new Date().toISOString(),
        refreshTokenValidUntil: oauthInfo.refreshTokenValidUntil,
        createdAt: new Date().toISOString(),
    });
    return {
        status: 'password_setup' as const,
        oauthSessionId: passwordSetup.id,
        email: passwordSetup.email,
        successStatus,
    };
};

export const appRouter = router({
    health: router({
        ping: procedure.query(() => ({
            ok: true,
            now: new Date().toISOString(),
        })),
    }),
    me: procedure.query(async ({ ctx }) => {
        const sessionToken = ctx.requestHeaders['x-session-token'] as string | undefined;
        if (!sessionToken) return null;
        const session = await ctx.sessions.getSession(sessionToken);
        if (!session) return null;
        const user = await ctx.users.findById(session.userId);
        return user ? toPublicUser(user) : null;
    }),
    lobby: router({
        notice: procedure.query(async ({ ctx }) => {
            const setting = await ctx.prisma.systemSetting.findUnique({
                where: { id: 1 },
            });
            return purifyGatewayNoticeHtml(setting?.notice);
        }),
        profiles: procedure
            .input(
                z
                    .object({
                        sessionToken: z.string().min(1).optional(),
                    })
                    .optional()
            )
            .query(async ({ ctx, input }) => {
                const sessionToken =
                    (ctx.requestHeaders['x-session-token'] as string | undefined) ?? input?.sessionToken;
                const session = sessionToken ? await ctx.sessions.getSession(sessionToken) : null;
                const profileList = await ctx.profileStatus.listLobbyProfiles({
                    userId: session?.userId,
                });
                const user = session ? await ctx.users.findById(session.userId) : null;
                if (!user) {
                    return profileList.map((profile) => ({
                        ...profile,
                        localAccountPolicy: null,
                    }));
                }
                const specialAccessGrants = await ctx.users.listSpecialAccessGrants(user.id);
                return Promise.all(
                    profileList.map(async (profile) => {
                        const record = await ctx.profiles.getProfile(profile.profileName);
                        const policy = resolveLocalAccountProfilePolicy({
                            profile: record?.profile ?? profile.profile,
                            profileName: profile.profileName,
                            profileMeta: record?.meta,
                            defaultGraceDays: ctx.localAccountGraceDays,
                            user,
                            specialAccessGrants,
                        });
                        return {
                            ...profile,
                            localAccountPolicy: policy,
                        };
                    })
                );
            }),
    }),
    admin: adminRouter,
    account: accountRouter,
    auth: router({
        bootstrapLocal: procedure
            .input(
                z.object({
                    token: zBootstrapToken,
                    username: zUsername,
                    password: zPassword,
                    displayName: z.string().min(2).max(40).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const expected = process.env.GATEWAY_BOOTSTRAP_TOKEN ?? '';
                if (!expected) {
                    throw new TRPCError({
                        code: 'FORBIDDEN',
                        message: 'Bootstrap is disabled.',
                    });
                }
                if (input.token !== expected) {
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: 'Invalid bootstrap token.',
                    });
                }
                const existing = await ctx.prisma.appUser.findFirst({
                    select: { id: true },
                });
                if (existing) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'Bootstrap is already completed.',
                    });
                }
                const created = await ctx.users.createUser({
                    username: input.username,
                    password: input.password,
                    displayName: input.displayName,
                });
                const bootstrappedUser = {
                    ...created,
                    roles: ['superuser'],
                };
                await ctx.users.updateRoles(created.id, bootstrappedUser.roles);
                const session = await ctx.sessions.createSession(bootstrappedUser);
                return {
                    user: toPublicUser(bootstrappedUser),
                    sessionToken: session.sessionToken,
                    issuedAt: session.issuedAt,
                };
            }),
        kakaoStart: procedure
            .input(
                z
                    .object({
                        mode: zOAuthMode.optional(),
                        scopes: z.array(z.string()).optional(),
                        sessionToken: z.string().min(1).optional(),
                    })
                    .optional()
            )
            .query(async ({ ctx, input }) => {
                const mode = input?.mode ?? 'login';
                const scopes = mergeRequiredKakaoScopes(input?.scopes);
                let userId: string | undefined;
                if (mode === 'verify') {
                    const sessionToken =
                        (ctx.requestHeaders['x-session-token'] as string | undefined) ?? input?.sessionToken;
                    const session = sessionToken ? await ctx.sessions.getSession(sessionToken) : null;
                    if (!session) {
                        throw new TRPCError({
                            code: 'UNAUTHORIZED',
                            message: '카카오 인증을 연결하려면 먼저 로그인해야 합니다.',
                        });
                    }
                    userId = session.userId;
                }
                const pending = await ctx.oauthSessions.createPendingState(mode, scopes, userId);
                const authUrl = ctx.kakaoClient.buildAuthUrl(pending.state, pending.scopes);
                return {
                    mode,
                    state: pending.state,
                    authUrl,
                };
            }),
        kakaoExchange: procedure
            .input(
                z.object({
                    code: z.string().min(1),
                    state: z.string().min(1),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const pending = await ctx.oauthSessions.consumePendingState(input.state);
                if (!pending) {
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: 'Invalid OAuth state.',
                    });
                }
                const token = await ctx.kakaoClient.exchangeCode(input.code);
                const tokenIssuedAt = new Date();

                const signupResult = await ctx.kakaoClient.signup(token.accessToken);
                const alreadyRegisteredWithKakao = !signupResult.id && signupResult.alreadyRegistered;
                if (!signupResult.id && !alreadyRegisteredWithKakao) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '카카오 앱 연결에 실패했습니다.',
                    });
                }
                const me = await ctx.kakaoClient.getMe(token.accessToken);
                const profile = (() => {
                    try {
                        return readVerifiedKakaoProfile(me);
                    } catch (error) {
                        return throwKakaoVerificationError(error);
                    }
                })();
                const [existingById, existingByEmail] = await Promise.all([
                    ctx.users.findByOauthId('KAKAO', profile.kakaoId),
                    ctx.users.findByEmail(profile.email),
                ]);

                if (pending.mode === 'verify') {
                    if (!pending.userId) {
                        throw new TRPCError({
                            code: 'UNAUTHORIZED',
                            message: '카카오 인증 연결 세션이 올바르지 않습니다.',
                        });
                    }
                    const localUser = await ctx.users.findById(pending.userId);
                    if (!localUser) {
                        throw new TRPCError({
                            code: 'NOT_FOUND',
                            message: '연결할 로컬 계정을 찾지 못했습니다.',
                        });
                    }
                    if (isLoginBanned(localUser.sanctions)) {
                        throw new TRPCError({
                            code: 'FORBIDDEN',
                            message: 'Account login is blocked.',
                        });
                    }
                    if (existingById && existingById.id !== localUser.id) {
                        throw new TRPCError({
                            code: 'CONFLICT',
                            message: '이미 다른 계정에 연결된 카카오 계정입니다.',
                        });
                    }
                    if (existingByEmail && existingByEmail.id !== localUser.id) {
                        throw new TRPCError({
                            code: 'CONFLICT',
                            message: '이미 다른 계정에서 사용 중인 카카오 이메일입니다. 관리자에게 문의해 주세요.',
                        });
                    }
                    if (localUser.oauthType === 'KAKAO' && localUser.oauthId !== profile.kakaoId) {
                        throw new TRPCError({
                            code: 'CONFLICT',
                            message: '이미 다른 카카오 계정에 연결된 사용자입니다.',
                        });
                    }
                    const oauthInfo = oauthInfoFromToken(token, tokenIssuedAt, localUser.oauthInfo);
                    let verified: UserRecord;
                    if (existingById?.id !== localUser.id && localUser.oauthType !== 'KAKAO') {
                        try {
                            verified = await ctx.users.linkKakao(localUser.id, {
                                oauthId: profile.kakaoId,
                                email: profile.email,
                                oauthInfo,
                                verifiedAt: new Date(),
                            });
                        } catch (error) {
                            throw new TRPCError({
                                code: 'CONFLICT',
                                message: '이미 다른 계정에 연결된 카카오 계정입니다.',
                                cause: error,
                            });
                        }
                    } else {
                        try {
                            verified = await ctx.users.syncKakaoIdentity(localUser.id, profile.email, oauthInfo);
                        } catch (error) {
                            throw new TRPCError({
                                code: 'CONFLICT',
                                message: '이미 다른 계정에서 사용 중인 카카오 이메일입니다. 관리자에게 문의해 주세요.',
                                cause: error,
                            });
                        }
                    }
                    const refreshed = (await ctx.users.findById(verified.id)) ?? verified;
                    await ctx.flushPublisher.publishUserFlush(refreshed.id, 'kakao-verified');
                    return finishKakaoLoginOrRequestPasswordSetup(ctx, refreshed, token.accessToken, 'verified');
                }

                if (pending.mode === 'change_pw') {
                    if (!existingById) {
                        throw new TRPCError({
                            code: 'NOT_FOUND',
                            message: '카카오 계정에 연결된 사용자를 찾지 못했습니다.',
                        });
                    }
                    const oauthInfo = oauthInfoFromToken(token, tokenIssuedAt, existingById.oauthInfo);
                    let existing: UserRecord;
                    try {
                        existing = await ctx.users.syncKakaoIdentity(existingById.id, profile.email, oauthInfo);
                    } catch (error) {
                        throw new TRPCError({
                            code: 'CONFLICT',
                            message: '이미 다른 계정에서 사용 중인 카카오 이메일입니다. 관리자에게 문의해 주세요.',
                            cause: error,
                        });
                    }
                    const nextPasswordChange = existing.oauthInfo?.nextPasswordChange
                        ? parseDate(existing.oauthInfo.nextPasswordChange)
                        : null;
                    const now = new Date();
                    if (nextPasswordChange && isAfter(nextPasswordChange, now)) {
                        throw new TRPCError({
                            code: 'TOO_MANY_REQUESTS',
                            message: '비밀번호 초기화는 잠시 후 다시 시도해주세요.',
                        });
                    }
                    const tempPassword = randomBytes(4).toString('hex');
                    await ctx.kakaoClient.sendTalkMessage(
                        token.accessToken,
                        `임시 비밀번호는 ${tempPassword} 입니다. 로그인 후 바로 다른 비밀번호로 변경해주세요.`,
                        ctx.publicBaseUrl
                    );
                    const nextChange = addHours(now, 4).toISOString();
                    await ctx.users.updatePassword(existing.id, tempPassword);
                    await ctx.users.updateOAuthInfo(existing.id, {
                        ...oauthInfo,
                        nextPasswordChange: nextChange,
                    });
                    return {
                        status: 'change_pw' as const,
                        ok: true,
                    };
                }

                if (existingById) {
                    if (isLoginBanned(existingById.sanctions)) {
                        throw new TRPCError({
                            code: 'FORBIDDEN',
                            message: 'Account login is blocked.',
                        });
                    }
                    const oauthInfo = oauthInfoFromToken(token, tokenIssuedAt, existingById.oauthInfo);
                    let synced: UserRecord;
                    try {
                        synced = await ctx.users.syncKakaoIdentity(existingById.id, profile.email, oauthInfo);
                    } catch (error) {
                        throw new TRPCError({
                            code: 'CONFLICT',
                            message: '이미 다른 계정에서 사용 중인 카카오 이메일입니다. 관리자에게 문의해 주세요.',
                            cause: error,
                        });
                    }
                    return finishKakaoLoginOrRequestPasswordSetup(ctx, synced, token.accessToken, 'login');
                }

                const joinOauthInfo = oauthInfoFromToken(token, tokenIssuedAt);
                const recoveryIntent = existingByEmail
                    ? ('link_existing' as const)
                    : alreadyRegisteredWithKakao
                      ? ('rejoin' as const)
                      : ('register' as const);
                const stored = await ctx.oauthSessions.createSession({
                    mode: pending.mode,
                    intent: recoveryIntent,
                    targetUserId: existingByEmail?.id,
                    kakaoId: profile.kakaoId,
                    email: profile.email,
                    accessToken: token.accessToken,
                    refreshToken: token.refreshToken,
                    accessTokenValidUntil: joinOauthInfo.accessTokenValidUntil!,
                    refreshTokenValidUntil: joinOauthInfo.refreshTokenValidUntil,
                    createdAt: new Date().toISOString(),
                });

                if (recoveryIntent !== 'register') {
                    return {
                        status: 'account_recovery' as const,
                        action: recoveryIntent,
                        oauthSessionId: stored.id,
                        email: stored.email,
                    };
                }

                return {
                    status: 'join' as const,
                    oauthSessionId: stored.id,
                    email: stored.email,
                };
            }),
        kakaoResolveAccount: procedure
            .input(
                z.object({
                    oauthSessionId: z.string().min(1),
                    action: zKakaoRecoveryAction,
                })
            )
            .mutation(async ({ ctx, input }) => {
                const oauthSession = await ctx.oauthSessions.consumeSession(input.oauthSessionId);
                if (!oauthSession) {
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: '카카오 계정 복구 세션이 만료되었습니다.',
                    });
                }
                if (oauthSession.intent !== input.action) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '카카오 계정 복구 선택이 올바르지 않습니다.',
                    });
                }

                if (input.action === 'rejoin') {
                    const [oauthOwner, emailOwner] = await Promise.all([
                        ctx.users.findByOauthId('KAKAO', oauthSession.kakaoId),
                        ctx.users.findByEmail(oauthSession.email),
                    ]);
                    if (oauthOwner || emailOwner) {
                        throw new TRPCError({
                            code: 'CONFLICT',
                            message: '연결할 기존 계정이 확인되었습니다. 카카오 로그인을 처음부터 다시 진행해 주세요.',
                        });
                    }
                    const registrationSession = await ctx.oauthSessions.createSession({
                        mode: oauthSession.mode,
                        intent: 'register',
                        kakaoId: oauthSession.kakaoId,
                        email: oauthSession.email,
                        accessToken: oauthSession.accessToken,
                        refreshToken: oauthSession.refreshToken,
                        accessTokenValidUntil: oauthSession.accessTokenValidUntil,
                        refreshTokenValidUntil: oauthSession.refreshTokenValidUntil,
                        createdAt: new Date().toISOString(),
                    });
                    return {
                        status: 'join' as const,
                        oauthSessionId: registrationSession.id,
                        email: registrationSession.email,
                    };
                }

                if (!oauthSession.targetUserId) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: '연결할 기존 계정을 찾지 못했습니다. 카카오 로그인을 처음부터 다시 진행해 주세요.',
                    });
                }
                const [targetUser, emailOwner, oauthOwner] = await Promise.all([
                    ctx.users.findById(oauthSession.targetUserId),
                    ctx.users.findByEmail(oauthSession.email),
                    ctx.users.findByOauthId('KAKAO', oauthSession.kakaoId),
                ]);
                if (!targetUser || emailOwner?.id !== targetUser.id) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message:
                            '보존된 이메일의 계정 정보가 변경되었습니다. 카카오 로그인을 처음부터 다시 진행해 주세요.',
                    });
                }
                if (oauthOwner && oauthOwner.id !== targetUser.id) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: '이미 다른 계정에 연결된 카카오 계정입니다.',
                    });
                }
                if (targetUser.deleteAfter) {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: '탈퇴 처리 중인 계정에는 카카오 계정을 다시 연결할 수 없습니다.',
                    });
                }
                if (isLoginBanned(targetUser.sanctions)) {
                    throw new TRPCError({
                        code: 'FORBIDDEN',
                        message: 'Account login is blocked.',
                    });
                }

                const oauthInfo: UserOAuthInfo = {
                    accessToken: oauthSession.accessToken,
                    refreshToken: oauthSession.refreshToken,
                    accessTokenValidUntil: oauthSession.accessTokenValidUntil,
                    refreshTokenValidUntil: oauthSession.refreshTokenValidUntil,
                };
                let linked: UserRecord;
                try {
                    linked = await ctx.users.relinkKakaoByEmail(targetUser.id, {
                        oauthId: oauthSession.kakaoId,
                        email: oauthSession.email,
                        oauthInfo,
                        verifiedAt: new Date(),
                    });
                } catch (error) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: '카카오 계정 연결 상태가 변경되었습니다. 처음부터 다시 진행해 주세요.',
                        cause: error,
                    });
                }
                await ctx.flushPublisher.publishUserFlush(linked.id, 'kakao-account-relinked');
                return finishKakaoLoginOrRequestPasswordSetup(ctx, linked, oauthSession.accessToken, 'login');
            }),
        kakaoSetPassword: procedure
            .input(
                z.object({
                    oauthSessionId: z.string().uuid(),
                    credential: zPasswordEnvelope,
                })
            )
            .mutation(async ({ ctx, input }) => {
                const password = openPassword(ctx.passwordEnvelope, input.credential);
                const oauthSession = await ctx.oauthSessions.consumeSession(input.oauthSessionId);
                if (!oauthSession || oauthSession.intent !== 'password_setup' || !oauthSession.targetUserId) {
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: '비밀번호 설정 세션이 만료되었습니다. 카카오 로그인을 다시 진행해 주세요.',
                    });
                }
                const user = await ctx.users.findById(oauthSession.targetUserId);
                if (
                    !user ||
                    user.oauthType !== 'KAKAO' ||
                    user.oauthId !== oauthSession.kakaoId ||
                    user.email?.toLowerCase() !== oauthSession.email.toLowerCase() ||
                    !user.passwordResetRequired
                ) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: '카카오 계정 연결 상태가 변경되었습니다. 처음부터 다시 진행해 주세요.',
                    });
                }
                if (user.deleteAfter) {
                    throw new TRPCError({ code: 'FORBIDDEN', message: 'Account deletion is pending.' });
                }
                if (isLoginBanned(user.sanctions)) {
                    throw new TRPCError({ code: 'FORBIDDEN', message: 'Account login is blocked.' });
                }
                let verifiedProfile;
                try {
                    verifiedProfile = readVerifiedKakaoProfile(await ctx.kakaoClient.getMe(oauthSession.accessToken));
                } catch (error) {
                    return throwKakaoVerificationError(error);
                }
                if (
                    verifiedProfile.kakaoId !== oauthSession.kakaoId ||
                    verifiedProfile.email !== oauthSession.email.toLowerCase()
                ) {
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: '카카오 계정 정보가 비밀번호 설정 세션과 일치하지 않습니다.',
                    });
                }
                await ctx.users.updatePassword(user.id, password);
                const refreshed = await ctx.users.findById(user.id);
                if (!refreshed) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: '계정을 찾지 못했습니다.' });
                }
                await ctx.flushPublisher.publishUserFlush(refreshed.id, 'password-changed');
                return finishKakaoLogin(
                    ctx,
                    refreshed,
                    oauthSession.accessToken,
                    oauthSession.mode === 'verify' ? 'verified' : 'login'
                );
            }),
        register: procedure
            .input(
                z.object({
                    oauthSessionId: z.string().min(1),
                    username: zRegistrationUsername,
                    credential: zPasswordEnvelope,
                    displayName: zDisplayName,
                    termsAgreed: z.literal(true),
                    privacyAgreed: z.literal(true),
                    thirdPartyUse: z.boolean(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                if (!ctx.localRegistrationEnabled) {
                    throw new TRPCError({
                        code: 'FORBIDDEN',
                        message: '현재는 가입이 금지되어있습니다!',
                    });
                }
                const password = openPassword(ctx.passwordEnvelope, input.credential);
                const oauthSession = await ctx.oauthSessions.consumeSession(input.oauthSessionId);
                if (!oauthSession) {
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: 'OAuth 세션이 만료되었습니다.',
                    });
                }
                if (oauthSession.intent && oauthSession.intent !== 'register') {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: '카카오 계정 복구 여부를 먼저 선택해 주세요.',
                    });
                }
                const existing = await ctx.users.findByUsername(input.username);
                if (existing) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'Username already exists.',
                    });
                }
                const existingDisplayName = await ctx.users.findByDisplayName(input.displayName);
                if (existingDisplayName) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: '이미 사용중인 닉네임입니다.',
                    });
                }
                const existingOAuth =
                    (await ctx.users.findByOauthId('KAKAO', oauthSession.kakaoId)) ??
                    (await ctx.users.findByEmail(oauthSession.email));
                if (existingOAuth) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'OAuth account already registered.',
                    });
                }
                const oauthInfo: UserOAuthInfo = {
                    accessToken: oauthSession.accessToken,
                    refreshToken: oauthSession.refreshToken,
                    accessTokenValidUntil: oauthSession.accessTokenValidUntil,
                    refreshTokenValidUntil: oauthSession.refreshTokenValidUntil,
                };
                let created: Awaited<ReturnType<typeof ctx.users.createUser>>;
                try {
                    const now = new Date();
                    created = await ctx.users.createUser({
                        username: input.username,
                        password,
                        displayName: input.displayName,
                        termsAcceptedAt: now,
                        privacyAcceptedAt: now,
                        thirdPartyUse: input.thirdPartyUse,
                        oauth: {
                            type: 'KAKAO',
                            id: oauthSession.kakaoId,
                            email: oauthSession.email,
                            info: oauthInfo,
                        },
                    });
                } catch (error) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'Username already exists.',
                        cause: error,
                    });
                }
                return finishKakaoLogin(ctx, created, oauthSession.accessToken, 'login');
            }),
        passwordKey: procedure.query(({ ctx }) => ctx.passwordEnvelope.getPublicKey()),
        checkRegistrationField: procedure
            .input(
                z.discriminatedUnion('field', [
                    z.object({ field: z.literal('username'), value: zRegistrationUsername }),
                    z.object({ field: z.literal('displayName'), value: zDisplayName }),
                ])
            )
            .query(async ({ ctx, input }) => {
                const existing =
                    input.field === 'username'
                        ? await ctx.users.findByUsername(input.value)
                        : await ctx.users.findByDisplayName(input.value);
                return {
                    available: !existing,
                    normalizedValue: input.value,
                    message: existing
                        ? input.field === 'username'
                            ? '이미 사용중인 계정명입니다.'
                            : '이미 사용중인 닉네임입니다.'
                        : '사용할 수 있습니다.',
                };
            }),
        registerLocal: procedure
            .input(
                z.object({
                    username: zRegistrationUsername,
                    credential: zPasswordEnvelope,
                    displayName: zDisplayName,
                    termsAgreed: z.literal(true),
                    privacyAgreed: z.literal(true),
                    thirdPartyUse: z.boolean(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                if (!ctx.localRegistrationEnabled) {
                    throw new TRPCError({
                        code: 'FORBIDDEN',
                        message: '현재는 가입이 금지되어있습니다!',
                    });
                }
                const [existingUser, existingDisplayName] = await Promise.all([
                    ctx.users.findByUsername(input.username),
                    ctx.users.findByDisplayName(input.displayName),
                ]);
                if (existingUser) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: '이미 사용중인 계정명입니다.',
                    });
                }
                if (existingDisplayName) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: '이미 사용중인 닉네임입니다.',
                    });
                }
                const password = openPassword(ctx.passwordEnvelope, input.credential);
                const now = new Date();
                let created: Awaited<ReturnType<typeof ctx.users.createUser>>;
                try {
                    created = await ctx.users.createUser({
                        username: input.username,
                        password,
                        displayName: input.displayName,
                        termsAcceptedAt: now,
                        privacyAcceptedAt: now,
                        thirdPartyUse: input.thirdPartyUse,
                    });
                } catch (error) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: '이미 사용중인 계정명 또는 닉네임입니다.',
                        cause: error,
                    });
                }
                const session = await ctx.sessions.createSession(created);
                return {
                    user: toPublicUser(created),
                    sessionToken: session.sessionToken,
                    issuedAt: session.issuedAt,
                    requiresKakaoVerification: true,
                };
            }),
        login: procedure
            .input(
                z.object({
                    username: zUsername,
                    credential: zPasswordEnvelope,
                })
            )
            .mutation(async ({ ctx, input }) => {
                const user = await ctx.users.findByUsername(input.username);
                if (!user) {
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: 'Invalid username or password.',
                    });
                }
                if (user.deleteAfter) {
                    throw new TRPCError({
                        code: 'FORBIDDEN',
                        message: 'Account deletion is pending.',
                    });
                }
                const password = openPassword(ctx.passwordEnvelope, input.credential);
                const ok = await ctx.users.verifyPassword(user, password);
                if (!ok) {
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: 'Invalid username or password.',
                    });
                }
                if (isLoginBanned(user.sanctions)) {
                    throw new TRPCError({
                        code: 'FORBIDDEN',
                        message: 'Account login is blocked.',
                    });
                }
                if (user.oauthType === 'KAKAO') {
                    const specialAccessGrants = await ctx.users.listSpecialAccessGrants(user.id);
                    if (hasOperatorSpecialAccess(user) || hasActiveSpecialAccountGrant(specialAccessGrants)) {
                        const session = await ctx.sessions.createSession(user);
                        return {
                            status: 'login' as const,
                            user: toPublicUser(user),
                            sessionToken: session.sessionToken,
                            issuedAt: session.issuedAt,
                        };
                    }
                    const ready = await verifyStoredKakaoIdentity({
                        user,
                        users: ctx.users,
                        kakaoClient: ctx.kakaoClient,
                    }).catch((error: unknown) => throwKakaoVerificationError(error));
                    return finishKakaoLogin(ctx, ready.user, ready.accessToken, 'login');
                }
                const session = await ctx.sessions.createSession(user);
                return {
                    status: 'login' as const,
                    user: toPublicUser(user),
                    sessionToken: session.sessionToken,
                    issuedAt: session.issuedAt,
                };
            }),
        kakaoOtp: procedure
            .input(
                z.object({
                    challengeId: z.string().uuid(),
                    code: z.string().regex(/^\d{4}$/, '인증 코드는 숫자 4자리입니다.'),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const verified = await verifyKakaoTalkChallenge({
                    challengeId: input.challengeId,
                    code: input.code,
                    oauthSessions: ctx.oauthSessions,
                    users: ctx.users,
                }).catch((error: unknown) => throwKakaoVerificationError(error));
                if (verified.user.deleteAfter) {
                    throw new TRPCError({
                        code: 'FORBIDDEN',
                        message: 'Account deletion is pending.',
                    });
                }
                if (isLoginBanned(verified.user.sanctions)) {
                    throw new TRPCError({
                        code: 'FORBIDDEN',
                        message: 'Account login is blocked.',
                    });
                }
                const session = await ctx.sessions.createSession(verified.user);
                return {
                    status: 'login' as const,
                    user: toPublicUser(verified.user),
                    sessionToken: session.sessionToken,
                    issuedAt: session.issuedAt,
                    validUntil: verified.validUntil,
                };
            }),
        me: procedure
            .input(
                z.object({
                    sessionToken: z.string().min(1),
                })
            )
            .query(async ({ ctx, input }) => {
                const session = await ctx.sessions.getSession(input.sessionToken);
                if (!session) {
                    return null;
                }
                const user = await ctx.users.findById(session.userId);
                if (!user) {
                    return null;
                }
                return {
                    user: toPublicUser(user),
                    issuedAt: session.issuedAt,
                };
            }),
        logout: procedure
            .input(
                z.object({
                    sessionToken: z.string().min(1),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const session = await ctx.sessions.getSession(input.sessionToken);
                await ctx.sessions.revokeSession(input.sessionToken, { revokeGames: true });
                if (session) {
                    await ctx.flushPublisher.publishUserFlush(session.userId, 'logout');
                }
                return { ok: true };
            }),
        issueGameSession: procedure
            .input(
                z.object({
                    sessionToken: z.string().min(1),
                    profile: zProfile,
                })
            )
            .mutation(async ({ ctx, input }) => {
                const gatewaySession = await ctx.sessions.getSession(input.sessionToken);
                if (!gatewaySession) {
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: 'Session is not valid.',
                    });
                }
                const user = await ctx.users.findById(gatewaySession.userId);
                if (!user) {
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: 'Session user no longer exists.',
                    });
                }
                const profileRecord = await ctx.profiles.getProfile(input.profile);
                const profile = profileRecord?.profile ?? input.profile.split(':', 1)[0] ?? input.profile;
                if (isGameAccessBlocked(user.sanctions, [input.profile, profile])) {
                    throw new TRPCError({
                        code: 'FORBIDDEN',
                        message: 'Game access is restricted for this account.',
                    });
                }
                const localAccountPolicy = resolveLocalAccountProfilePolicy({
                    profile,
                    profileName: input.profile,
                    profileMeta: profileRecord?.meta,
                    defaultGraceDays: ctx.localAccountGraceDays,
                    user,
                    specialAccessGrants: await ctx.users.listSpecialAccessGrants(user.id),
                });
                if (!localAccountPolicy.accessAllowed) {
                    throw new TRPCError({
                        code: 'FORBIDDEN',
                        message: '카카오 인증 유예기간이 만료되었습니다. 인증 후 계속 이용할 수 있습니다.',
                    });
                }
                const gameSession = await ctx.sessions.createGameSession(input.sessionToken, input.profile);
                if (!gameSession) {
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: 'Session is not valid.',
                    });
                }
                const now = new Date();
                const accountIcon = resolveEffectiveAccountIcon(user);
                const accountIcons = await ctx.users.listIcons(user.id);
                const payload = {
                    version: 1,
                    profile: gameSession.profile,
                    issuedAt: now.toISOString(),
                    expiresAt: addSeconds(now, ctx.gameSessionTtlSeconds).toISOString(),
                    sessionId: gameSession.gameToken,
                    user: {
                        id: user.id,
                        username: user.username,
                        displayName: user.displayName,
                        picture: accountIcon.picture,
                        imageServer: accountIcon.imageServer,
                        iconUpdatedAt: accountIcon.revision,
                        ...(user.profileIconResetAt ? { profileIconResetAt: user.profileIconResetAt } : {}),
                        canUseGeneralPicture: user.legacyGrade === undefined || user.legacyGrade >= 1,
                        roles: user.roles,
                        createdAt: user.createdAt,
                        legacyMemberNo: user.legacyMemberNo,
                        icons: accountIcons.map((icon) => ({
                            id: icon.id,
                            picture: icon.picture,
                            imageServer: icon.imageServer,
                            createdAt: icon.createdAt,
                        })),
                    },
                    sanctions: user.sanctions,
                    identity: {
                        kakaoVerified: localAccountPolicy.kakaoVerified,
                        canCreateGeneral: localAccountPolicy.canCreateGeneral,
                        requiresKakaoVerification: localAccountPolicy.requiresKakaoVerification,
                        graceEndsAt: localAccountPolicy.graceEndsAt,
                        ...(localAccountPolicy.specialAccess
                            ? {
                                  specialAccess: {
                                      kind: localAccountPolicy.specialAccess.kind,
                                      expiresAt: localAccountPolicy.specialAccess.expiresAt,
                                  },
                              }
                            : {}),
                    },
                } as const;
                const gameToken = encryptGameSessionToken(payload, ctx.gameTokenSecret);
                return {
                    profile: gameSession.profile,
                    gameToken,
                    issuedAt: payload.issuedAt,
                };
            }),
        validateGameSession: procedure
            .input(
                z.object({
                    profile: zProfile,
                    gameToken: z.string().min(1),
                })
            )
            .query(async ({ ctx, input }) => {
                const payload = decryptGameSessionToken(input.gameToken, ctx.gameTokenSecret);
                if (!payload) {
                    return null;
                }
                if (payload.profile !== input.profile) {
                    return null;
                }
                const expiresAt = parseDate(payload.expiresAt);
                if (!expiresAt || isAfter(new Date(), expiresAt)) {
                    return null;
                }
                return {
                    profile: payload.profile,
                    sessionToken: payload.sessionId,
                    user: {
                        id: payload.user.id,
                        username: payload.user.username,
                        displayName: payload.user.displayName,
                    },
                    issuedAt: payload.issuedAt,
                };
            }),
    }),
});

export type AppRouter = typeof appRouter;
