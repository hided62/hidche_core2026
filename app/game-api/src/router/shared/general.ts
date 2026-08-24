import { TRPCError } from '@trpc/server';
import type { GameApiContext } from '../../context.js';

export const getAuthenticatedUserId = (ctx: Pick<GameApiContext, 'auth'>): string => {
    const userId = ctx.auth?.user.id;
    if (!userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return userId;
};

export const getMyGeneral = async (ctx: Pick<GameApiContext, 'db' | 'auth'>) => {
    const userId = getAuthenticatedUserId(ctx);
    const general = await ctx.db.general.findFirst({
        where: { userId },
    });
    if (!general) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'General not found' });
    }
    return general;
};

export const getOwnedGeneral = async (ctx: Pick<GameApiContext, 'db' | 'auth'>, generalId: number) => {
    const userId = getAuthenticatedUserId(ctx);
    const general = await ctx.db.general.findUnique({
        where: { id: generalId },
    });
    if (!general) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'General not found.' });
    }
    if (general.userId !== userId) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'General is not owned by the authenticated user.',
        });
    }
    return general;
};
