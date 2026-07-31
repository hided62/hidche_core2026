import { asNumber, asRecord, JosaUtil } from '@sammo-ts/common';
import { LogCategory, LogFormat, LogScope, type LogEntryDraft } from '@sammo-ts/logic';

import type { InMemoryTurnWorld, TurnCalendarHandler } from './inMemoryWorld.js';
import { queueYearbookSnapshot } from './yearbookHandler.js';

const buildUnificationLog = (nationName: string): LogEntryDraft => ({
    scope: LogScope.SYSTEM,
    category: LogCategory.HISTORY,
    format: LogFormat.YEAR_MONTH,
    text: `<C>●</><Y><b>【통일】</b></><D><b>${nationName}</b></>${JosaUtil.pick(nationName, '이')} 전토를 통일하였습니다.`,
    meta: {},
});

const buildNationHistoryLog = (nationId: number, nationName: string): LogEntryDraft => ({
    scope: LogScope.NATION,
    category: LogCategory.HISTORY,
    format: LogFormat.YEAR_MONTH,
    nationId,
    text: `<D><b>${nationName}</b></>${JosaUtil.pick(nationName, '이')} 전토를 통일`,
    meta: {},
});

const buildGeneralActionLog = (generalId: number, nationId: number, nationName: string): LogEntryDraft => ({
    scope: LogScope.GENERAL,
    category: LogCategory.ACTION,
    format: LogFormat.YEAR_MONTH,
    generalId,
    nationId,
    text: `<D><b>${nationName}</b></>${JosaUtil.pick(nationName, '이')} 전토를 통일하였습니다.`,
    meta: {},
});

const resolveServerId = (world: InMemoryTurnWorld, fallback: string): string => {
    const serverId = world.getState().meta.serverId;
    return typeof serverId === 'string' && serverId.trim() ? serverId.trim() : fallback;
};

export const createUnificationHandler = (options: {
    profileName: string;
    getWorld: () => InMemoryTurnWorld | null;
}): { handler: TurnCalendarHandler } => ({
    handler: {
        onMonthChanged: (context) => {
            const world = options.getWorld();
            if (!world) return;

            const state = world.getState();
            const meta = asRecord(state.meta);
            if (asNumber(meta.isunited ?? meta.isUnited, 0) !== 0) return;

            const activeNations = world.listNations().filter((nation) => nation.level > 0);
            if (activeNations.length !== 1) return;

            const winner = activeNations[0]!;
            const cities = world.listCities();
            if (cities.length === 0 || cities.some((city) => city.nationId !== winner.id)) return;

            const serverId = resolveServerId(world, options.profileName);
            world.updateWorldMeta({
                isUnited: 2,
                isunited: 2,
                refreshLimit: asNumber(meta.refreshLimit, 0) * 100,
            });
            world.pushLog(buildNationHistoryLog(winner.id, winner.name));
            for (const general of world.listGenerals().filter((entry) => entry.nationId === winner.id)) {
                world.pushLog(buildGeneralActionLog(general.id, winner.id, winner.name));
            }
            world.pushLog(buildUnificationLog(winner.name));

            queueYearbookSnapshot(world, options.profileName, context.currentYear, context.currentMonth);
            world.queueUnificationFinalization({
                generationKey: `unification:${serverId}`,
                serverId,
                profileName: options.profileName,
                winnerNationId: winner.id,
                year: context.currentYear,
                month: context.currentMonth,
                completedAt: new Date(state.lastTurnTime.getTime()),
            });
        },
    },
});
