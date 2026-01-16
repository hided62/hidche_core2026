import { TRPCError } from '@trpc/server';
import { decryptGameSessionToken } from '@sammo-ts/common';
import { isAfter, isValid, parseISO } from 'date-fns';
import { z } from 'zod';

import type { GameSessionTokenPayload } from '@sammo-ts/common';
import { procedure, router } from '../../trpc.js';

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

const verifyGatewayToken = (
    token: string,
    profileName: string,
    secret: string
): GameSessionTokenPayload | null => {
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
    exchangeGatewayToken: procedure
        .input(z.object({ gatewayToken: z.string().min(1) }))
        .mutation(async ({ ctx, input }) => {
            const payload = verifyGatewayToken(
                input.gatewayToken,
                ctx.profile.name,
                ctx.gameTokenSecret
            );
            if (!payload) {
                throw new TRPCError({
                    code: 'UNAUTHORIZED',
                    message: 'Invalid gateway token.',
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
