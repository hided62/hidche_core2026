import { TRPCError } from '@trpc/server';
import { isCanonicalIsoTimestamp, type AccountIconProjection } from '@sammo-ts/common';

import type { GameApiContext } from '../context.js';
import { ConflictingTurnDaemonCommandError } from '../daemon/databaseTransport.js';
import type { AccountIconSource } from '../auth/accountIconSource.js';
import type { GatewayUserFlushEvent } from '../auth/flushStore.js';
import type { TurnDaemonTransport } from '../daemon/transport.js';

export const loadAuthoritativeAccountIcon = async (
    ctx: GameApiContext,
    userId: string
): Promise<AccountIconProjection> => {
    if (!ctx.accountIconSource) {
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Gateway 계정 아이콘 원장이 구성되지 않았습니다.',
        });
    }
    try {
        const projection = await ctx.accountIconSource.get(userId);
        if (!projection) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: 'Gateway에서 계정 정보를 찾을 수 없습니다.',
            });
        }
        return projection;
    } catch (error) {
        if (error instanceof TRPCError) {
            throw error;
        }
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Gateway 계정 아이콘 정보를 확인할 수 없습니다.',
        });
    }
};

export const adjustAccountIconForUser = async (
    ctx: GameApiContext,
    userId: string,
    selected: AccountIconProjection,
    enforceCooldown = true,
    requestKey?: string
): Promise<{
    ok: true;
    generalId: number | null;
    updated: boolean;
}> => {
    const projection = selected;
    const requestId = `general:adjustIcon:${userId}:manual:${requestKey ?? `${projection.revision}:${encodeURIComponent(projection.picture)}`}`;
    try {
        const result = await ctx.turnDaemon.requestCommand({
            type: 'adjustGeneralIcon',
            requestId,
            userId,
            picture: projection.picture,
            imageServer: projection.imageServer,
            iconRevision: projection.revision,
            enforceCooldown,
        });
        if (!result) {
            throw new TRPCError({
                code: 'TIMEOUT',
                message: '요청은 접수됐지만 처리 결과를 아직 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.',
            });
        }
        if (result.type !== 'adjustGeneralIcon') {
            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: '턴 데몬이 올바르지 않은 아이콘 적용 결과를 반환했습니다.',
            });
        }
        if (!result.ok) {
            throw new TRPCError({
                code: result.code,
                message: result.reason,
            });
        }
        return {
            ok: true,
            generalId: result.generalId,
            updated: result.updated,
        };
    } catch (error) {
        if (
            error instanceof ConflictingTurnDaemonCommandError ||
            (error instanceof Error && error.name === 'ConflictingTurnDaemonCommandError')
        ) {
            throw new TRPCError({
                code: 'CONFLICT',
                message: '이미 접수된 아이콘 적용 요청과 최신 계정 정보가 다릅니다.',
            });
        }
        throw error;
    }
};

export const enqueueProfileIconResetForUser = async (
    ctx: GameApiContext,
    userId: string,
    expectedResetRevision: string
): Promise<boolean> => {
    const projection = await loadAuthoritativeAccountIcon(ctx, userId);
    if (
        projection.revision !== expectedResetRevision ||
        projection.picture !== 'default.jpg' ||
        projection.imageServer !== 0
    ) {
        return false;
    }
    await ctx.turnDaemon.sendCommand({
        type: 'adjustGeneralIcon',
        requestId: `general:adjustIcon:${userId}:${projection.revision}`,
        userId,
        picture: projection.picture,
        imageServer: projection.imageServer,
        iconRevision: projection.revision,
    });
    return true;
};

export const createAdminProfileIconResetFlushHandler =
    (source: AccountIconSource, turnDaemon: TurnDaemonTransport) =>
    async (event: GatewayUserFlushEvent): Promise<void> => {
        if (event.reason !== 'admin-profile-icon-reset') {
            return;
        }
        if (!event.iconRevision || !isCanonicalIsoTimestamp(event.iconRevision)) {
            return;
        }
        const projection = await source.get(event.userId);
        if (
            !projection ||
            projection.revision !== event.iconRevision ||
            projection.picture !== 'default.jpg' ||
            projection.imageServer !== 0
        ) {
            return;
        }
        await turnDaemon.sendCommand({
            type: 'adjustGeneralIcon',
            requestId: `general:adjustIcon:${event.userId}:${projection.revision}`,
            userId: event.userId,
            picture: projection.picture,
            imageServer: projection.imageServer,
            iconRevision: projection.revision,
        });
    };
