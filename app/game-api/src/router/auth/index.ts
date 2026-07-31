import { TRPCError } from '@trpc/server';
import { decryptGameSessionToken } from '@sammo-ts/common/auth/gameToken';
import { isGameAccessBlocked } from '@sammo-ts/common/auth/sanctions';
import { isAfter, isValid, parseISO } from 'date-fns';
import { z } from 'zod';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { authedProcedure, engineProcedure, router } from '../../trpc.js';
import { enqueueProfileIconResetForUser } from '../../services/accountIconSync.js';

const parseDate = (value: string): Date | null => {
    const parsed = parseISO(value);
    return isValid(parsed) ? parsed : null;
};

const resolveTtlSeconds = (expiresAt: string): number => {
    const parsed = parseDate(expiresAt);
    if (!parsed) {
        return 0;
    }
    const ttl = Math.floor((parsed.getTime() - Date.now()) / 1000);
    return ttl > 0 ? ttl : 0;
};

const verifyGatewayToken = (token: string, profileName: string, secret: string): GameSessionTokenPayload | null => {
    const payload = decryptGameSessionToken(token, secret);
    if (!payload) {
        return null;
    }
    if (payload.profile !== profileName) {
        return null;
    }
    const expiresAt = parseDate(payload.expiresAt);
    const issuedAt = parseDate(payload.issuedAt);
    if (!expiresAt || !issuedAt) {
        return null;
    }
    if (isAfter(new Date(), expiresAt)) {
        return null;
    }
    return payload;
};

export const authRouter = router({
    status: authedProcedure.query(({ ctx }) => {
        const userId = ctx.auth?.user.id;
        if (!userId) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
        }
        return { userId };
    }),
    exchangeGatewayToken: engineProcedure
        .input(z.object({ gatewayToken: z.string().min(1) }))
        .mutation(async ({ ctx, input }) => {
            const payload = verifyGatewayToken(input.gatewayToken, ctx.profile.name, ctx.gameTokenSecret);
            if (!payload) {
                throw new TRPCError({
                    code: 'UNAUTHORIZED',
                    message: 'Invalid gateway token.',
                });
            }
            if (isGameAccessBlocked(payload.sanctions, [ctx.profile.name, ctx.profile.id])) {
                throw new TRPCError({
                    code: 'FORBIDDEN',
                    message: 'Game access is restricted for this account.',
                });
            }
            const flushedAt = ctx.flushStore.getFlushedAt(payload.user.id);
            if (flushedAt && new Date(payload.issuedAt) <= flushedAt) {
                throw new TRPCError({
                    code: 'UNAUTHORIZED',
                    message: 'Gateway token revoked.',
                });
            }

            const ttlSeconds = resolveTtlSeconds(payload.expiresAt);
            if (ttlSeconds <= 0) {
                throw new TRPCError({
                    code: 'UNAUTHORIZED',
                    message: 'Gateway token expired.',
                });
            }

            if (payload.user.profileIconResetAt && payload.user.profileIconResetAt === payload.user.iconUpdatedAt) {
                // 일반 계정 아이콘 변경은 Ref처럼 사용자가 고른 서버에만 적용한다.
                // 관리자 reset만 다음 인증 경계에서 durable하게 복구한다.
                await enqueueProfileIconResetForUser(ctx, payload.user.id, payload.user.profileIconResetAt);
            }

            const used = await ctx.accessTokenStore.markGatewayTokenUsed(payload.sessionId, ttlSeconds);
            if (!used) {
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: 'Gateway token already used.',
                });
            }

            const created = await ctx.accessTokenStore.create(payload);
            if (!created) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to issue access token.',
                });
            }

            return {
                accessToken: created.accessToken,
                expiresAt: created.expiresAt,
                issuedAt: payload.issuedAt,
            };
        }),
});
