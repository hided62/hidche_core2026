import { TRPCError } from '@trpc/server';
import type { GameApiContext } from '../../context.js';

export const getMyGeneral = async (ctx: Pick<GameApiContext, 'db' | 'auth'>) => {
    if (!ctx.auth?.user.id) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    const general = await ctx.db.general.findFirst({
        where: { userId: ctx.auth.user.id },
    });
    if (!general) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'General not found' });
    }
    return general;
};

export const getOwnedGeneral = async (
    ctx: Pick<GameApiContext, 'db' | 'auth'>,
    generalId: number
) => {
    if (!ctx.auth?.user.id) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    const general = await ctx.db.general.findUnique({
        where: { id: generalId },
    });
    if (!general) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'General not found.' });
    }
    if (general.userId !== ctx.auth.user.id) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'General is not owned by the authenticated user.',
        });
    }
    return general;
};
