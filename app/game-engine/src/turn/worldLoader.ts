import {
    createGamePostgresConnector,
    type JsonValue,
    type TurnEngineCityRow,
    type TurnEngineDatabaseClient,
    type TurnEngineDiplomacyRow,
    type TurnEngineGeneralRow,
    type TurnEngineGeneralAccessLogRow,
    type TurnEngineInheritancePointRow,
    type TurnEngineRankDataRow,
    type TurnEngineNationRow,
    type TurnEngineTroopRow,
} from '@sammo-ts/infra';
import type {
    City,
    GeneralItemSlots,
    GeneralLastTurn,
    Nation,
    ScenarioConfig,
    ScenarioGeneralPoolCandidate,
    ScenarioMeta,
    Troop,
    TriggerValue,
} from '@sammo-ts/logic';
import { normalizeScenarioEffect } from '@sammo-ts/logic';
import { parseScenarioGeneralPoolCandidate } from '@sammo-ts/logic';
import { projectItemSlots, readItemInventoryFromMeta } from '@sammo-ts/logic/items/index.js';
import { z } from 'zod';
import { GameClock, asRecord, isRecord, type GameClockMode } from '@sammo-ts/common';

import type { MapLoaderOptions } from '../scenario/mapLoader.js';
import { loadMapDefinitionByName } from '../scenario/mapLoader.js';
import type { UnitSetLoaderOptions } from '../scenario/unitSetLoader.js';
import { loadUnitSetDefinitionByName } from '../scenario/unitSetLoader.js';
import type { TurnDiplomacy, TurnEvent, TurnGeneral, TurnGeneralPoolEntry, TurnWorldLoadResult } from './types.js';
import { readDiplomacyMeta } from '@sammo-ts/logic';
import { applyPersistedRankRowsToMeta } from './rankData.js';

interface TurnWorldLoaderOptions {
    databaseUrl: string;
    mapOptions?: MapLoaderOptions;
    unitSetOptions?: UnitSetLoaderOptions;
}

type JsonRecord = Record<string, unknown>;

const asTriggerRecord = (value: unknown): Record<string, TriggerValue> =>
    isRecord(value) ? (value as Record<string, TriggerValue>) : {};

const normalizeGeneralLastTurn = (value: unknown): GeneralLastTurn => {
    const raw = asRecord(value);
    const arg = asRecord(raw.arg);
    return {
        command: typeof raw.command === 'string' ? raw.command : '휴식',
        ...(Object.keys(arg).length > 0 ? { arg } : {}),
        ...(typeof raw.term === 'number' && Number.isFinite(raw.term) ? { term: Math.floor(raw.term) } : {}),
        ...(typeof raw.seq === 'number' && Number.isFinite(raw.seq) ? { seq: Math.floor(raw.seq) } : {}),
    };
};

const normalizeCode = (value: string | null | undefined): string | null => {
    if (!value || value === 'None') {
        return null;
    }
    return value;
};

const readMetaNumber = (meta: Record<string, unknown>, key: string): number | null => {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
};

const toSafeTick = (value: bigint, field: string): number => {
    const tick = Number(value);
    if (!Number.isSafeInteger(tick)) {
        throw new Error(`${field} is outside the JavaScript safe integer range: ${value}`);
    }
    return tick;
};

const parseClockMode = (value: string): GameClockMode => {
    if (value === 'realtime' || value === 'manual') {
        return value;
    }
    throw new Error(`world_state.clock_mode is invalid: ${value}`);
};

const zScenarioStatBlock = z.object({
    total: z.number(),
    min: z.number(),
    max: z.number(),
    npcTotal: z.number(),
    npcMax: z.number(),
    npcMin: z.number(),
    chiefMin: z.number(),
});

const zScenarioEnvironment = z.object({
    mapName: z.string(),
    unitSet: z.string(),
    scenarioEffect: z
        .union([z.string(), z.null()])
        .optional()
        .refine(
            (value) => {
                try {
                    normalizeScenarioEffect(value);
                    return true;
                } catch {
                    return false;
                }
            },
            { message: 'Unknown scenario effect' }
        ),
});

const zScenarioConfig = z.object({
    stat: zScenarioStatBlock,
    iconPath: z.string(),
    map: z.record(z.string(), z.unknown()),
    const: z.record(z.string(), z.unknown()),
    environment: zScenarioEnvironment,
});

const zScenarioMeta = z.object({
    title: z.string(),
    startYear: z.number().nullable(),
    life: z.number().nullable(),
    fiction: z.number().nullable(),
    history: z.array(z.string()),
    ignoreDefaultEvents: z.boolean(),
});

const parseScenarioMeta = (meta: JsonRecord): ScenarioMeta | undefined => {
    const raw = meta.scenarioMeta;
    const parsed = zScenarioMeta.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
};

const parseLegacyLastTurnTime = (meta: JsonRecord): Date | null => {
    const raw = meta.lastTurnTime;
    if (typeof raw !== 'string') {
        return null;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const resolveLegacyTurnTime = (
    generalRows: readonly TurnEngineGeneralRow[],
    meta: JsonRecord,
    updatedAt: Date | null | undefined
): Date => {
    const stored = parseLegacyLastTurnTime(meta);
    if (stored) {
        return stored;
    }
    const earliest = generalRows.reduce<Date | null>(
        (result, row) => (!result || row.turnTime.getTime() < result.getTime() ? row.turnTime : result),
        null
    );
    return earliest ?? updatedAt ?? new Date();
};

const mapScenarioConfig = (raw: JsonValue): ScenarioConfig => {
    const parsed = zScenarioConfig.safeParse(raw);
    if (!parsed.success) {
        throw new Error(`world_state.config is invalid: ${parsed.error.message}`);
    }
    return {
        ...parsed.data,
        environment: {
            ...parsed.data.environment,
            scenarioEffect: normalizeScenarioEffect(parsed.data.environment.scenarioEffect),
        },
    };
};

const mapGeneralRow = (
    row: TurnEngineGeneralRow,
    gameClock: GameClock,
    rankRows: readonly TurnEngineRankDataRow[],
    inheritanceRows: readonly TurnEngineInheritancePointRow[],
    accessRow?: TurnEngineGeneralAccessLogRow
): TurnGeneral => {
    const legacySlots: GeneralItemSlots = {
        horse: normalizeCode(row.horseCode),
        weapon: normalizeCode(row.weaponCode),
        book: normalizeCode(row.bookCode),
        item: normalizeCode(row.itemCode),
    };
    const rawMeta = { ...(asTriggerRecord(row.meta) as Record<string, unknown>) };
    applyPersistedRankRowsToMeta(rawMeta, rankRows);
    const inheritancePoints = Object.fromEntries(inheritanceRows.map((entry) => [entry.key, entry.value]));
    const itemInventory = readItemInventoryFromMeta(rawMeta, legacySlots);
    return {
        ...((): { meta: TurnGeneral['meta'] } => {
            const meta = rawMeta;
            const killturn = readMetaNumber(meta, 'killturn');
            if (killturn === null) {
                throw new Error(`general.meta.killturn is required (generalId=${row.id}).`);
            }
            return { meta: { ...meta, killturn } as TurnGeneral['meta'] };
        })(),
        id: row.id,
        userId: row.userId,
        name: row.name,
        nationId: row.nationId,
        cityId: row.cityId,
        troopId: row.troopId,
        stats: {
            leadership: row.leadership,
            strength: row.strength,
            intelligence: row.intel,
        },
        experience: row.experience,
        dedication: row.dedication,
        officerLevel: row.officerLevel,
        role: {
            personality: normalizeCode(row.personalCode),
            specialDomestic: normalizeCode(row.specialCode),
            specialWar: normalizeCode(row.special2Code),
            items: projectItemSlots(itemInventory),
        },
        injury: row.injury,
        gold: row.gold,
        rice: row.rice,
        crew: row.crew,
        crewTypeId: row.crewTypeId,
        train: row.train,
        atmos: row.atmos,
        age: row.age,
        startAge: row.startAge,
        npcState: row.npcState,
        bornYear: row.bornYear,
        deadYear: row.deadYear,
        affinity: row.affinity,
        picture: row.picture,
        imageServer: row.imageServer,
        triggerState: {
            flags: {},
            counters: {},
            modifiers: {},
            meta: {},
        },
        itemInventory,
        lastTurn: normalizeGeneralLastTurn(row.lastTurn),
        penalty: row.penalty,
        // meta는 상단에서 보장 처리됨.
        turnTick:
            row.turnTick === null
                ? gameClock.dateToTick(row.turnTime)
                : toSafeTick(row.turnTick, `general.turn_tick(${row.id})`),
        turnTime:
            row.turnTick === null
                ? row.turnTime
                : gameClock.tickToDate(toSafeTick(row.turnTick, `general.turn_tick(${row.id})`)),
        recentWarTick:
            row.recentWarTick === null
                ? row.recentWarTime
                    ? gameClock.dateToTick(row.recentWarTime)
                    : null
                : toSafeTick(row.recentWarTick, `general.recent_war_tick(${row.id})`),
        recentWarTime:
            row.recentWarTick === null
                ? (row.recentWarTime ?? null)
                : gameClock.tickToDate(toSafeTick(row.recentWarTick, `general.recent_war_tick(${row.id})`)),
        inheritancePoints,
        ...(accessRow ? { refreshScoreTotal: accessRow.refreshScoreTotal } : {}),
    };
};

const mapCityRow = (row: TurnEngineCityRow): City => {
    // trust/trade/region are projected columns. Old flushes also copied them
    // into JSON meta; never let a stale duplicate override a nullable column.
    const { trust: _storedTrust, trade: _storedTrade, region: _storedRegion, ...meta } = asTriggerRecord(row.meta);
    const state = typeof meta.state === 'number' && Number.isFinite(meta.state) ? Math.floor(meta.state) : 0;
    return {
        id: row.id,
        name: row.name,
        nationId: row.nationId,
        level: row.level,
        state,
        population: row.population,
        populationMax: row.populationMax,
        agriculture: row.agriculture,
        agricultureMax: row.agricultureMax,
        commerce: row.commerce,
        commerceMax: row.commerceMax,
        security: row.security,
        securityMax: row.securityMax,
        supplyState: row.supplyState,
        frontState: row.frontState,
        defence: row.defence,
        defenceMax: row.defenceMax,
        wall: row.wall,
        wallMax: row.wallMax,
        conflict: asTriggerRecord(row.conflict),
        meta: {
            ...meta,
            trust: row.trust,
            ...(row.trade === null ? {} : { trade: row.trade }),
            region: row.region,
        },
    };
};

const mapNationRow = (row: TurnEngineNationRow): Nation => {
    const meta = asTriggerRecord(row.meta);
    return {
        id: row.id,
        name: row.name,
        color: row.color,
        capitalCityId: row.capitalCityId,
        chiefGeneralId: row.chiefGeneralId,
        gold: row.gold,
        rice: row.rice,
        power: readMetaNumber(meta, 'power') ?? 0,
        level: row.level,
        typeCode: row.typeCode,
        meta: {
            ...meta,
            tech: row.tech,
        },
    };
};

const mapDiplomacyRow = (row: TurnEngineDiplomacyRow): TurnDiplomacy => {
    const { meta, dead } = readDiplomacyMeta(asRecord(row.meta));
    return {
        fromNationId: row.srcNationId,
        toNationId: row.destNationId,
        state: row.stateCode,
        term: row.term,
        dead,
        meta,
    };
};

const mapEventRow = (row: {
    id: number;
    targetCode: string;
    priority: number;
    condition: JsonValue;
    action: JsonValue;
    meta: JsonValue;
}): TurnEvent => ({
    id: row.id,
    targetCode: row.targetCode,
    priority: row.priority,
    condition: row.condition,
    action: row.action,
    meta: asRecord(row.meta),
});

const mapGeneralPoolRow = (row: {
    id: number;
    uniqueName: string;
    ownerUserId: string | null;
    generalId: number | null;
    reservedUntil: Date | null;
    reservedUntilTick: bigint | null;
    info: JsonValue;
}): TurnGeneralPoolEntry => ({
    id: row.id,
    uniqueName: row.uniqueName,
    ownerUserId: row.ownerUserId,
    generalId: row.generalId,
    reservedUntil: row.reservedUntil,
    reservedUntilTick:
        row.reservedUntilTick === null
            ? null
            : toSafeTick(row.reservedUntilTick, `select_pool.reserved_until_tick(${row.id})`),
    candidate: parseScenarioGeneralPoolCandidate(row) satisfies ScenarioGeneralPoolCandidate,
});

const mapTroopRow = (row: TurnEngineTroopRow): Troop => ({
    id: row.troopLeaderId,
    nationId: row.nationId,
    name: row.name,
});

export const loadTurnWorldFromDatabase = async (options: TurnWorldLoaderOptions): Promise<TurnWorldLoadResult> => {
    const connector = createGamePostgresConnector({ url: options.databaseUrl });
    await connector.connect();
    try {
        const prisma: TurnEngineDatabaseClient = connector.prisma;
        const worldState = await prisma.worldState.findFirst();
        if (!worldState) {
            throw new Error('world_state row is required to start turn daemon.');
        }

        const [
            generalRows,
            rankRows,
            inheritanceRows,
            accessRows,
            cityRows,
            nationRows,
            diplomacyRows,
            troopRows,
            eventRows,
            generalPoolRows,
        ] = await Promise.all([
            prisma.general.findMany(),
            prisma.rankData.findMany(),
            prisma.inheritancePoint.findMany(),
            prisma.generalAccessLog.findMany(),
            prisma.city.findMany(),
            prisma.nation.findMany(),
            prisma.diplomacy.findMany(),
            prisma.troop.findMany(),
            prisma.event.findMany({
                orderBy: [{ priority: 'desc' }, { id: 'asc' }],
            }),
            prisma.selectPoolEntry.findMany({ orderBy: { id: 'asc' } }),
        ]);

        const meta = asRecord(worldState.meta);
        const legacyLastTurnTime = resolveLegacyTurnTime(generalRows, meta, worldState.updatedAt);
        const hasPersistedClock =
            worldState.clockBaseTime !== null &&
            worldState.clockTick !== null &&
            worldState.clockWallAnchor !== null &&
            worldState.lastTurnTick !== null;
        const clockMode = hasPersistedClock ? parseClockMode(worldState.clockMode) : 'manual';
        const clockBaseTime = worldState.clockBaseTime ?? legacyLastTurnTime;
        const clockWallAnchor = worldState.clockWallAnchor ?? legacyLastTurnTime;
        const bootstrapClock = new GameClock({
            baseTime: clockBaseTime,
            tick: 0,
            mode: clockMode,
            wallAnchor: clockWallAnchor,
            turnSeconds: worldState.tickSeconds,
        });
        const legacyLastTurnTick = bootstrapClock.dateToTick(legacyLastTurnTime);
        const gameClock = new GameClock({
            baseTime: clockBaseTime,
            tick:
                worldState.clockTick === null
                    ? legacyLastTurnTick
                    : toSafeTick(worldState.clockTick, 'world_state.clock_tick'),
            mode: clockMode,
            wallAnchor: clockWallAnchor,
            turnSeconds: worldState.tickSeconds,
        });

        const ranksByGeneral = new Map<number, TurnEngineRankDataRow[]>();
        for (const row of rankRows) {
            const bucket = ranksByGeneral.get(row.generalId) ?? [];
            bucket.push(row);
            ranksByGeneral.set(row.generalId, bucket);
        }
        const inheritanceByUser = new Map<string, TurnEngineInheritancePointRow[]>();
        for (const row of inheritanceRows) {
            const bucket = inheritanceByUser.get(row.userId) ?? [];
            bucket.push(row);
            inheritanceByUser.set(row.userId, bucket);
        }
        const accessByGeneral = new Map(accessRows.map((row) => [row.generalId, row]));
        // MariaDB legacy scans these tables in their primary-key order. Prisma
        // findMany() does not promise an order, and Map insertion order can
        // otherwise leak into monthly RNG and AI candidate traversal.
        const generals = generalRows
            .map((row) =>
                mapGeneralRow(
                    row,
                    gameClock,
                    ranksByGeneral.get(row.id) ?? [],
                    row.userId ? (inheritanceByUser.get(row.userId) ?? []) : [],
                    accessByGeneral.get(row.id)
                )
            )
            .sort((left, right) => left.id - right.id);
        const cities = cityRows.map(mapCityRow).sort((left, right) => left.id - right.id);
        const nations = nationRows.map(mapNationRow).sort((left, right) => left.id - right.id);
        const diplomacy = diplomacyRows
            .map(mapDiplomacyRow)
            .sort((left, right) => left.fromNationId - right.fromNationId || left.toNationId - right.toNationId);
        const troops = troopRows.map(mapTroopRow).sort((left, right) => left.id - right.id);

        const worldConfig = asRecord(worldState.config);
        const scenarioConfig = mapScenarioConfig(worldState.config);
        const targetGeneralPool = scenarioConfig.map.targetGeneralPool;
        const mapName = scenarioConfig.environment?.mapName ?? 'che';
        const map = await loadMapDefinitionByName(mapName, options.mapOptions);
        const unitSetName = scenarioConfig.environment?.unitSet ?? 'che';
        const unitSet = await loadUnitSetDefinitionByName(unitSetName, options.unitSetOptions);

        const scenarioMeta = parseScenarioMeta(meta);

        const lastTurnTick =
            worldState.lastTurnTick === null
                ? legacyLastTurnTick
                : toSafeTick(worldState.lastTurnTick, 'world_state.last_turn_tick');
        const lastTurnTime = gameClock.tickToDate(lastTurnTick);

        const events = eventRows.filter((row) => row.targetCode !== 'initial').map(mapEventRow);
        const initialEvents = eventRows.filter((row) => row.targetCode === 'initial').map(mapEventRow);

        return {
            state: {
                id: worldState.id,
                currentYear: worldState.currentYear,
                currentMonth: worldState.currentMonth,
                tickSeconds: worldState.tickSeconds,
                lastTurnTime,
                clockBaseTime: gameClock.baseTime,
                clockTick: gameClock.tick,
                clockMode,
                clockWallAnchor: gameClock.wallAnchor,
                lastTurnTick,
                meta,
            },
            snapshot: {
                scenarioConfig,
                ...(scenarioMeta ? { scenarioMeta } : {}),
                worldConfig,
                map,
                unitSet,
                nations,
                cities,
                generals,
                troops,
                diplomacy,
                events,
                initialEvents,
                ...(typeof targetGeneralPool === 'string'
                    ? { generalPoolEntries: generalPoolRows.map(mapGeneralPoolRow) }
                    : {}),
            },
        };
    } finally {
        await connector.disconnect();
    }
};
