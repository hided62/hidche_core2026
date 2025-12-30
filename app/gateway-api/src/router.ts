import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { procedure, router } from './trpc.js';
import { toPublicUser } from './auth/userRepository.js';

const zUsername = z.string().min(2).max(32);
const zPassword = z.string().min(6).max(128);
const zProfile = z.string().min(1).max(64);

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
                await ctx.sessions.revokeSession(input.sessionToken, { revokeGames: true });
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
                return {
                    profile: gameSession.profile,
                    gameToken: gameSession.gameToken,
                    issuedAt: gameSession.issuedAt,
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
                const gameSession = await ctx.sessions.getGameSession(
                    input.profile,
                    input.gameToken
                );
                if (!gameSession) {
                    return null;
                }
                const session = await ctx.sessions.getSession(gameSession.sessionToken);
                if (!session) {
                    return null;
                }
                return {
                    profile: gameSession.profile,
                    sessionToken: gameSession.sessionToken,
                    user: {
                        id: gameSession.userId,
                        username: gameSession.username,
                        displayName: gameSession.displayName,
                    },
                    issuedAt: gameSession.issuedAt,
                };
            }),
    }),
});

export type AppRouter = typeof appRouter;
