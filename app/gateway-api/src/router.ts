import { randomBytes } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { addHours, addSeconds, isAfter, isValid, parseISO } from 'date-fns';
import { z } from 'zod';

import { decryptGameSessionToken, encryptGameSessionToken } from '@sammo-ts/common';

import { procedure, router } from './trpc.js';
import { toPublicUser } from './auth/userRepository.js';
import type { UserOAuthInfo } from './auth/userRepository.js';
import { adminRouter } from './adminRouter.js';

const zUsername = z.string().min(2).max(32);
const zPassword = z.string().min(6).max(128);
const zProfile = z.string().min(1).max(64);
const zOAuthMode = z.enum(['login', 'change_pw']);

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
                const sessionToken = input?.sessionToken;
                const session = sessionToken ? await ctx.sessions.getSession(sessionToken) : null;
                return ctx.profileStatus.listLobbyProfiles({
                    userId: session?.userId,
                });
            }),
    }),
    admin: adminRouter,
    auth: router({
        kakaoStart: procedure
            .input(
                z
                    .object({
                        mode: zOAuthMode.optional(),
                        scopes: z.array(z.string()).optional(),
                    })
                    .optional()
            )
            .query(async ({ ctx, input }) => {
                const mode = input?.mode ?? 'login';
                const scopes = input?.scopes ?? ['account_email'];
                const pending = await ctx.oauthSessions.createPendingState(mode, scopes);
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
                    username: zUsername,
                    password: zPassword,
                    displayName: z.string().min(2).max(40).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
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
                let created = null;
                try {
                    created = await ctx.users.createUser({
                        username: input.username,
                        password: input.password,
                        displayName: input.displayName,
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
        login: procedure
            .input(
                z.object({
                    username: zUsername,
                    password: zPassword,
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
                const ok = await ctx.users.verifyPassword(user, input.password);
                if (!ok) {
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: 'Invalid username or password.',
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
                return {
                    user: {
                        id: session.userId,
                        username: session.username,
                        displayName: session.displayName,
                    },
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
                const gameSession = await ctx.sessions.createGameSession(input.sessionToken, input.profile);
                if (!gameSession) {
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: 'Session is not valid.',
                    });
                }
                const now = new Date();
                const payload = {
                    version: 1,
                    profile: gameSession.profile,
                    issuedAt: now.toISOString(),
                    expiresAt: addSeconds(now, ctx.gameSessionTtlSeconds).toISOString(),
                    sessionId: gameSession.gameToken,
                    user: {
                        id: gameSession.userId,
                        username: gameSession.username,
                        displayName: gameSession.displayName,
                        roles: gameSession.roles,
                        createdAt: gameSession.createdAt,
                    },
                    sanctions: gameSession.sanctions,
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
