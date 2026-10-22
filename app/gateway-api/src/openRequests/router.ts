import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { procedure, router } from '../trpc.js';
import { isGatewaySessionCurrent } from '../auth/sessionValidity.js';
import type { GatewayApiContext } from '../context.js';
import { actOnOpenRequest, createOpenRequest, listOpenRequests, zOpeningInstall } from './service.js';

const memberProcedure = procedure.use(async ({ ctx, next }) => {
    const header = ctx.requestHeaders['x-session-token'];
    const token = Array.isArray(header) ? header[0] : header;
    const session = token ? await ctx.sessions.getSession(token) : null;
    const user = session ? await ctx.users.findById(session.userId) : null;
    if (!session || !user || !isGatewaySessionCurrent(session, user)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' });
    }
    return next({ ctx: { ...ctx, openingUser: user } });
});
const visibleProfile = async (ctx: GatewayApiContext, userId: string, profileName: string): Promise<void> => {
    const profiles = await ctx.profileStatus.listLobbyProfiles({ userId });
    if (!profiles.some((profile) => profile.profileName === profileName))
        throw new TRPCError({ code: 'NOT_FOUND', message: '서버를 찾을 수 없습니다.' });
};

export const openRequestsRouter = router({
    list: memberProcedure
        .input(z.object({ profileName: z.string().min(1).max(64) }).strict())
        .query(async ({ ctx, input }) => {
            await visibleProfile(ctx, ctx.openingUser.id, input.profileName);
            return listOpenRequests(ctx, ctx.openingUser, input.profileName);
        }),
    create: memberProcedure
        .input(z.object({ profileName: z.string().min(1).max(64), install: zOpeningInstall }).strict())
        .mutation(async ({ ctx, input }) => {
            await visibleProfile(ctx, ctx.openingUser.id, input.profileName);
            return createOpenRequest(ctx, ctx.openingUser, input.profileName, input.install);
        }),
    act: memberProcedure
        .input(z.object({ id: z.string().uuid(), action: z.enum(['ENDORSE', 'WITHDRAW']) }).strict())
        .mutation(async ({ ctx, input }) => {
            const request = await ctx.prisma.gatewayOpenRequest.findUnique({
                where: { id: input.id },
                select: { profileName: true },
            });
            if (!request) throw new TRPCError({ code: 'NOT_FOUND', message: '요청을 찾을 수 없습니다.' });
            await visibleProfile(ctx, ctx.openingUser.id, request.profileName);
            return actOnOpenRequest(ctx, ctx.openingUser, input.id, input.action);
        }),
});
