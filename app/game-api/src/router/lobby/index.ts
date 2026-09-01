import { TRPCError } from '@trpc/server';

import { asNumber, asRecord } from '@sammo-ts/common';

import { zWorldStateConfig, zWorldStateMeta } from '../../context.js';
import { isSelectionPoolWorld, resolveSelectionMaxGeneral } from '@sammo-ts/game-engine/turn/selectPoolService.js';
import { loadCurrentGameTime } from '../../services/gameClock.js';
import { loadTurnEngineRunning } from '../../services/turnEngineStatus.js';
import { procedure, router } from '../../trpc.js';

export const lobbyRouter = router({
    info: procedure.query(async ({ ctx }) => {
        const rawWorldState = await ctx.db.worldState.findFirst();
        if (!rawWorldState) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'World state not found',
            });
        }

        const worldState = {
            ...rawWorldState,
            config: zWorldStateConfig.parse(rawWorldState.config),
            meta: zWorldStateMeta.parse(rawWorldState.meta),
        };

        const userCnt = await ctx.db.general.count({ where: { npcState: { lt: 2 } } });
        const npcCnt = await ctx.db.general.count({ where: { npcState: { gte: 2 } } });
        const nationCnt = await ctx.db.nation.count({ where: { level: { gt: 0 } } });
        const rawConfig = asRecord(rawWorldState.config);
        const scenarioTitle = asRecord(asRecord(rawWorldState.meta).scenarioMeta).title;
        const autorunUser = worldState.meta.autorun_user;
        const autorunOptions = autorunUser?.options
            ? Object.entries(autorunUser.options)
                  .filter(([, enabled]) => enabled)
                  .map(([option]) => option)
            : [];
        const gameTime = await loadCurrentGameTime(ctx.db);
        const turnEngineRunning = await loadTurnEngineRunning(ctx.profileStatusSource, ctx.db, ctx.profile.name);

        let myGeneral = null;
        if (ctx.auth?.user.id) {
            const general = await ctx.db.general.findFirst({
                where: { userId: ctx.auth.user.id },
                select: { name: true, picture: true, imageServer: true },
            });
            if (general) {
                myGeneral = {
                    name: general.name,
                    picture: general.picture,
                    imageServer: general.imageServer,
                };
            }
        }

        return {
            serverId: worldState.meta.serverId?.trim() || ctx.profile?.name || 'game',
            profile: ctx.profile.id,
            gameIdx: worldState.meta.gameIdx ?? 1,
            year: worldState.currentYear,
            month: worldState.currentMonth,
            userCnt,
            maxUserCnt: resolveSelectionMaxGeneral(rawWorldState),
            npcCnt,
            nationCnt,
            turnTerm: worldState.tickSeconds / 60,
            fictionMode: worldState.config.fictionMode ?? '사실',
            starttime: worldState.meta.starttime ?? '',
            opentime: worldState.meta.opentime ?? '',
            preopenAt: worldState.meta.preopenAt ?? '',
            turntime: worldState.meta.turntime ?? '',
            serverTime: gameTime.now.toISOString(),
            serverWallTime: gameTime.wallNow.toISOString(),
            clockMode: gameTime.mode ?? 'realtime',
            clockRunning: gameTime.running,
            clockStartsAt: gameTime.startsAt?.toISOString() ?? null,
            turnEngineRunning,
            otherTextInfo: worldState.meta.otherTextInfo ?? '',
            npcMode: worldState.config.npcMode ?? 0,
            defaultStatTotal: asNumber(asRecord(rawConfig.stat).total, 165),
            autorunUser:
                autorunUser?.limit_minutes && autorunUser.limit_minutes > 0 && autorunOptions.length > 0
                    ? {
                          limitMinutes: autorunUser.limit_minutes,
                          options: autorunOptions,
                      }
                    : null,
            isUnited: worldState.meta.isunited ?? worldState.meta.isUnited ?? 0,
            selectionPoolEnabled: isSelectionPoolWorld(rawWorldState),
            directGeneralCreationEnabled: (Math.floor(asNumber(rawConfig.blockGeneralCreate, 0)) & 1) === 0,
            npcPossessionEnabled: worldState.config.npcMode === 1,
            scenarioTitle: typeof scenarioTitle === 'string' ? scenarioTitle : '',
            myGeneral,
        };
    }),
});
