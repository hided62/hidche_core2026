import { GameClock, MAX_SAFE_GAME_TICK, type GameClockMode } from '@sammo-ts/common';
import { createGamePostgresConnector } from '@sammo-ts/infra';

import {
    projectCoreDatabaseSnapshot,
    CANONICAL_MESSAGE_VALID_UNTIL_INFINITE,
    projectCanonicalMessageValidUntil,
    type CanonicalTurnSnapshot,
    type TurnSnapshotEntityIds,
    type TurnSnapshotSelector,
} from './canonical.js';

export const projectEffectiveCoreMessageValidUntil = (
    row: { validUntil: Date | string; validUntilTick?: bigint | number | null },
    clock: GameClock | null
): string | typeof CANONICAL_MESSAGE_VALID_UNTIL_INFINITE => {
    if (clock && row.validUntilTick !== null && row.validUntilTick !== undefined) {
        const tick = Number(row.validUntilTick);
        if (!Number.isSafeInteger(tick)) {
            throw new Error(
                `message.valid_until_tick is outside the JavaScript safe integer range: ${String(row.validUntilTick)}`
            );
        }
        if (tick === MAX_SAFE_GAME_TICK) {
            return CANONICAL_MESSAGE_VALID_UNTIL_INFINITE;
        }
        return projectCanonicalMessageValidUntil(clock.tickToDate(tick));
    }
    return projectCanonicalMessageValidUntil(row.validUntil);
};

export const readCoreDatabaseEntityIds = async (databaseUrl: string): Promise<TurnSnapshotEntityIds> => {
    const connector = createGamePostgresConnector({ url: databaseUrl });
    await connector.connect();
    try {
        const db = connector.prisma;
        const [generals, cities, nations, troops] = await Promise.all([
            db.general.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
            db.city.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
            db.nation.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
            db.troop.findMany({ select: { troopLeaderId: true }, orderBy: { troopLeaderId: 'asc' } }),
        ]);
        return {
            generalIds: generals.map((row) => row.id),
            cityIds: cities.map((row) => row.id),
            nationIds: nations.map((row) => row.id),
            troopIds: troops.map((row) => row.troopLeaderId),
        };
    } finally {
        await connector.disconnect();
    }
};

export const readCoreDatabaseSnapshot = async (
    databaseUrl: string,
    selector: TurnSnapshotSelector
): Promise<CanonicalTurnSnapshot> => {
    const connector = createGamePostgresConnector({ url: databaseUrl });
    await connector.connect();
    try {
        const db = connector.prisma;
        const world = await db.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
        const [generals, cities, nations] = await Promise.all([
            db.general.findMany({
                ...(selector.allGenerals ? {} : { where: { id: { in: selector.generalIds } } }),
                orderBy: { id: 'asc' },
            }),
            db.city.findMany({
                ...(selector.allCities ? {} : { where: { id: { in: selector.cityIds } } }),
                orderBy: { id: 'asc' },
            }),
            db.nation.findMany({
                ...(selector.allNations ? {} : { where: { id: { in: selector.nationIds } } }),
                orderBy: { id: 'asc' },
            }),
        ]);
        const generalIds = generals.map((row) => row.id);
        const nationIds = nations.map((row) => row.id);
        const wallNow = new Date();
        let currentMessageTime = wallNow;
        let currentMessageTick: bigint | null = null;
        let gameClock: GameClock | null = null;
        if (world.clockBaseTime && world.clockTick !== null && world.clockWallAnchor) {
            const mode: GameClockMode = world.clockMode === 'manual' ? 'manual' : 'realtime';
            const storedTick = Number(world.clockTick);
            if (!Number.isSafeInteger(storedTick)) {
                throw new Error(
                    `world_state.clock_tick is outside the JavaScript safe integer range: ${world.clockTick}`
                );
            }
            gameClock = new GameClock({
                baseTime: world.clockBaseTime,
                tick: storedTick,
                mode,
                wallAnchor: world.clockWallAnchor,
                turnSeconds: world.tickSeconds,
            });
            currentMessageTick = BigInt(gameClock.nowTick(wallNow));
            currentMessageTime = gameClock.tickToDate(Number(currentMessageTick));
        }
        const troopIds = new Set<number>([...(selector.troopIds ?? []), ...selector.generalIds]);
        for (const general of generals) {
            troopIds.add(general.id);
            if (general.troopId > 0) {
                troopIds.add(general.troopId);
            }
        }
        const [
            rankData,
            troops,
            diplomacy,
            generalTurns,
            nationTurns,
            logs,
            messages,
            latestMessage,
            messageReadStates,
            messageInboxRows,
        ] = await Promise.all([
            db.rankData.findMany({
                where: { generalId: { in: generalIds } },
                orderBy: [{ generalId: 'asc' }, { type: 'asc' }],
            }),
            db.troop.findMany({
                ...(selector.allTroops
                    ? {}
                    : { where: { troopLeaderId: { in: [...troopIds].sort((left, right) => left - right) } } }),
                orderBy: { troopLeaderId: 'asc' },
            }),
            db.diplomacy.findMany({
                where: {
                    srcNationId: { in: nationIds },
                    destNationId: { in: nationIds },
                },
                orderBy: [{ srcNationId: 'asc' }, { destNationId: 'asc' }],
            }),
            db.generalTurn.findMany({
                where: { generalId: { in: generalIds } },
                orderBy: [{ generalId: 'asc' }, { turnIdx: 'asc' }],
            }),
            db.nationTurn.findMany({
                where: { nationId: { in: nationIds } },
                orderBy: [{ nationId: 'asc' }, { officerLevel: 'asc' }, { turnIdx: 'asc' }],
            }),
            db.logEntry.findMany({
                where: {
                    id: { gt: selector.logAfterId ?? 0 },
                    OR: [{ scope: 'SYSTEM' }, { generalId: { in: generalIds } }, { nationId: { in: nationIds } }],
                },
                orderBy: { id: 'asc' },
            }),
            db.message.findMany({
                where: { id: { gt: selector.messageAfterId ?? 0 } },
                orderBy: { id: 'asc' },
            }),
            db.message.findFirst({
                select: { id: true },
                orderBy: { id: 'desc' },
            }),
            db.messageReadState.findMany({
                where: { generalId: { in: generalIds } },
                orderBy: { generalId: 'asc' },
            }),
            db.message.findMany({
                where: {
                    AND: [
                        {
                            OR: [
                                { type: 'private', mailbox: { in: generalIds } },
                                {
                                    type: 'diplomacy',
                                    mailbox: { in: nationIds.map((nationId) => 9_000 + nationId) },
                                },
                            ],
                        },
                        {
                            OR: [
                                ...(currentMessageTick === null
                                    ? []
                                    : [{ validUntilTick: { not: null, gt: currentMessageTick } }]),
                                { validUntilTick: null, validUntil: { gt: currentMessageTime } },
                            ],
                        },
                    ],
                },
                select: { id: true, mailbox: true, type: true, src: true },
                orderBy: { id: 'asc' },
            }),
        ]);
        return projectCoreDatabaseSnapshot({
            world: { ...world, gameNow: currentMessageTime },
            generals,
            rankData,
            cities,
            nations,
            troops,
            diplomacy,
            generalTurns,
            nationTurns,
            logs,
            messages: messages.map((row) => ({
                ...row,
                effectiveValidUntil: projectEffectiveCoreMessageValidUntil(row, gameClock),
            })),
            messageReadStates,
            messageInboxRows,
            messageWatermark: latestMessage?.id ?? 0,
            includeRankMirrors: selector.includeRankMirrors,
        });
    } finally {
        await connector.disconnect();
    }
};
