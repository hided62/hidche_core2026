import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
    decryptGameSessionToken,
    encryptGameSessionToken,
} from '@sammo-ts/common/auth/gameToken.js';

import { procedure, router } from './trpc.js';
import { toPublicUser } from './auth/userRepository.js';

const zUsername = z.string().min(2).max(32);
const zPassword = z.string().min(6).max(128);
const zProfile = z.string().min(1).max(64);

const parseDate = (value: string): Date | null => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed;
};

export const appRouter = router({
    health: router({
        ping: procedure.query(() => ({
            ok: true,
            now: new Date().toISOString(),
        })),
    }),
    auth: router({
        register: procedure
            .input(
                z.object({
                    username: zUsername,
                    password: zPassword,
                    displayName: z.string().min(2).max(40).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const existing = await ctx.users.findByUsername(input.username);
                if (existing) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'Username already exists.',
                    });
                }
                let created = null;
                try {
                    created = await ctx.users.createUser(input);
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
                const gameSession = await ctx.sessions.createGameSession(
                    input.sessionToken,
                    input.profile
                );
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
                    expiresAt: new Date(now.getTime() + 1000 * ctx.gameSessionTtlSeconds).toISOString(),
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
                if (!expiresAt || Date.now() > expiresAt.getTime()) {
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
