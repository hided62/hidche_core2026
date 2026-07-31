import { randomBytes } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { addHours, addSeconds, isAfter, isValid, parseISO } from 'date-fns';
import { z } from 'zod';

import { decryptGameSessionToken, encryptGameSessionToken } from '@sammo-ts/common/auth/gameToken';
import { isGameAccessBlocked, isLoginBanned } from '@sammo-ts/common/auth/sanctions';

import { procedure, router } from './trpc.js';
import { toPublicUser } from './auth/userRepository.js';
import type { UserOAuthInfo } from './auth/userRepository.js';
import { adminRouter } from './adminRouter.js';
import { accountRouter } from './account/router.js';
import { resolveLocalAccountProfilePolicy } from './auth/localAccountPolicy.js';
import { openPassword, zDisplayName, zPasswordEnvelope, zRegistrationUsername } from './auth/registrationInput.js';
import { resolveEffectiveAccountIcon } from './auth/accountIconProjection.js';

const zUsername = z
    .string()
    .min(2)
    .max(64)
    .transform((value) => value.trim().toLocaleLowerCase('en-US'));
const zPassword = z.string().min(6).max(128);
const zProfile = z.string().min(1).max(64);
const zOAuthMode = z.enum(['login', 'change_pw', 'verify']);
const zBootstrapToken = z.string().min(1);

const parseDate = (value: string): Date | null => {
    const parsed = parseISO(value);
    return isValid(parsed) ? parsed : null;
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
            return setting?.notice ?? '';
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
                return Promise.all(
                    profileList.map(async (profile) => {
                        const record = await ctx.profiles.getProfile(profile.profileName);
                        const policy = resolveLocalAccountProfilePolicy({
                            profile: record?.profile ?? profile.profile,
                            profileMeta: record?.meta,
                            defaultGraceDays: ctx.localAccountGraceDays,
                            user,
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
                const scopes = input?.scopes ?? ['account_email'];
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
                const accessTokenValidUntil = addSeconds(tokenIssuedAt, token.accessTokenExpiresIn).toISOString();
                const refreshTokenValidUntil = token.refreshTokenExpiresIn
                    ? addSeconds(tokenIssuedAt, token.refreshTokenExpiresIn).toISOString()
                    : undefined;

                const signupResult = await ctx.kakaoClient.signup(token.accessToken);
                if (!signupResult.id && signupResult.msg !== 'already registered') {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '카카오 앱 연결에 실패했습니다.',
                    });
                }
                const me = await ctx.kakaoClient.getMe(token.accessToken);
                const kakaoAccount = me.kakaoAccount;
                if (!kakaoAccount.hasEmail || !kakaoAccount.email) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '이메일 정보 제공에 동의해야 합니다.',
                    });
                }
                if (!kakaoAccount.isEmailValid || !kakaoAccount.isEmailVerified) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '카카오 계정 이메일이 인증되지 않았습니다.',
                    });
                }

                const oauthInfo: UserOAuthInfo = {
                    accessToken: token.accessToken,
                    refreshToken: token.refreshToken,
                    accessTokenValidUntil,
                    refreshTokenValidUntil,
                };

                const existing =
                    (await ctx.users.findByOauthId('KAKAO', me.id)) ??
                    (await ctx.users.findByEmail(kakaoAccount.email));

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
                    if (existing && existing.id !== localUser.id) {
                        throw new TRPCError({
                            code: 'CONFLICT',
                            message: '이미 다른 계정에 연결된 카카오 계정입니다.',
                        });
                    }
                    let verified = localUser;
                    if (existing?.id !== localUser.id) {
                        try {
                            verified = await ctx.users.linkKakao(localUser.id, {
                                oauthId: me.id,
                                email: kakaoAccount.email,
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
                    }
                    if (existing?.id === localUser.id) {
                        await ctx.users.updateOAuthInfo(localUser.id, oauthInfo);
                    }
                    const refreshed = (await ctx.users.findById(verified.id)) ?? verified;
                    const session = await ctx.sessions.createSession(refreshed);
                    await ctx.flushPublisher.publishUserFlush(refreshed.id, 'kakao-verified');
                    return {
                        status: 'verified' as const,
                        user: toPublicUser(refreshed),
                        sessionToken: session.sessionToken,
                        issuedAt: session.issuedAt,
                    };
                }

                if (pending.mode === 'change_pw') {
                    if (!existing) {
                        throw new TRPCError({
                            code: 'NOT_FOUND',
                            message: '카카오 계정에 연결된 사용자를 찾지 못했습니다.',
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

                if (existing) {
                    if (isLoginBanned(existing.sanctions)) {
                        throw new TRPCError({
                            code: 'FORBIDDEN',
                            message: 'Account login is blocked.',
                        });
                    }
                    await ctx.users.updateOAuthInfo(existing.id, oauthInfo);
                    const session = await ctx.sessions.createSession(existing);
                    return {
                        status: 'login' as const,
                        user: toPublicUser(existing),
                        sessionToken: session.sessionToken,
                        issuedAt: session.issuedAt,
                    };
                }

                const stored = await ctx.oauthSessions.createSession({
                    mode: pending.mode,
                    kakaoId: me.id,
                    email: kakaoAccount.email,
                    accessToken: token.accessToken,
                    refreshToken: token.refreshToken,
                    accessTokenValidUntil,
                    refreshTokenValidUntil,
                    createdAt: new Date().toISOString(),
                });

                return {
                    status: 'join' as const,
                    oauthSessionId: stored.id,
                    email: stored.email,
                };
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
                const session = await ctx.sessions.createSession(created);
                return {
                    user: toPublicUser(created),
                    sessionToken: session.sessionToken,
                    issuedAt: session.issuedAt,
                };
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
                const session = await ctx.sessions.createSession(user);
                return {
                    user: toPublicUser(user),
                    sessionToken: session.sessionToken,
                    issuedAt: session.issuedAt,
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
                    profileMeta: profileRecord?.meta,
                    defaultGraceDays: ctx.localAccountGraceDays,
                    user,
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
                    },
                    sanctions: user.sanctions,
                    identity: {
                        kakaoVerified: localAccountPolicy.kakaoVerified,
                        canCreateGeneral: localAccountPolicy.canCreateGeneral,
                        requiresKakaoVerification: localAccountPolicy.requiresKakaoVerification,
                        graceEndsAt: localAccountPolicy.graceEndsAt,
                    },
                } as const;
                const gameToken = encryptGameSessionToken(payload, ctx.gameTokenSecret);
                return {
                    profile: gameSession.profile,
                    gameToken,
                    issuedAt: payload.issuedAt,
                };
            }),
        flushUser: procedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    reason: z.string().min(1).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                await ctx.flushPublisher.publishUserFlush(input.userId, input.reason);
                return { ok: true };
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
