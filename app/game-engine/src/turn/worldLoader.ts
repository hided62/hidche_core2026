import {
    createGamePostgresConnector,
    type JsonValue,
    type TurnEngineCityRow,
    type TurnEngineDatabaseClient,
    type TurnEngineDiplomacyRow,
    type TurnEngineGeneralRow,
    type TurnEngineNationRow,
    type TurnEngineTroopRow,
} from '@sammo-ts/infra';
import type { City, Nation, ScenarioConfig, ScenarioMeta, Troop, TriggerValue } from '@sammo-ts/logic';
import { z } from 'zod';

import { getNextTickTime } from '../lifecycle/getNextTickTime.js';
import type { MapLoaderOptions } from '../scenario/mapLoader.js';
import { loadMapDefinitionByName } from '../scenario/mapLoader.js';
import type { UnitSetLoaderOptions } from '../scenario/unitSetLoader.js';
import { loadUnitSetDefinitionByName } from '../scenario/unitSetLoader.js';
import type { TurnDiplomacy, TurnGeneral, TurnWorldLoadResult } from './types.js';
import { readDiplomacyMeta } from '@sammo-ts/logic';

interface TurnWorldLoaderOptions {
    databaseUrl: string;
    mapOptions?: MapLoaderOptions;
    unitSetOptions?: UnitSetLoaderOptions;
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): JsonRecord => (isRecord(value) ? value : {});

const asTriggerRecord = (value: unknown): Record<string, TriggerValue> =>
    isRecord(value) ? (value as Record<string, TriggerValue>) : {};

const normalizeCode = (value: string | null | undefined): string | null => {
    if (!value || value === 'None') {
        return null;
    }
    return value;
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
    scenarioEffect: z.union([z.string(), z.null()]).optional(),
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

const parseLastTurnTime = (meta: JsonRecord): Date | null => {
    const raw = meta.lastTurnTime;
    if (typeof raw !== 'string') {
        return null;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed;
};

const resolveFallbackTurnTimeBase = (generals: TurnGeneral[], updatedAt: Date | null): Date => {
    let earliest: Date | null = null;
    for (const general of generals) {
        const turnTime = general.turnTime;
        if (!earliest || turnTime.getTime() < earliest.getTime()) {
            earliest = turnTime;
        }
    }
    if (earliest) {
        return earliest;
    }
    if (updatedAt) {
        return updatedAt;
    }
    return new Date();
};

const alignToPreviousTick = (base: Date, tickMinutes: number): Date => {
    const nextTick = getNextTickTime(base, tickMinutes);
    return new Date(nextTick.getTime() - tickMinutes * 60_000);
};

const mapScenarioConfig = (raw: JsonValue): ScenarioConfig => {
    const parsed = zScenarioConfig.safeParse(raw);
    if (!parsed.success) {
        throw new Error(`world_state.config is invalid: ${parsed.error.message}`);
    }
    return parsed.data;
};

const mapGeneralRow = (row: TurnEngineGeneralRow): TurnGeneral => ({
    id: row.id,
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
        items: {
            horse: normalizeCode(row.horseCode),
            weapon: normalizeCode(row.weaponCode),
            book: normalizeCode(row.bookCode),
            item: normalizeCode(row.itemCode),
        },
    },
    injury: row.injury,
    gold: row.gold,
    rice: row.rice,
    crew: row.crew,
    crewTypeId: row.crewTypeId,
    train: row.train,
    atmos: row.atmos,
    age: row.age,
    npcState: row.npcState,
    triggerState: {
        flags: {},
        counters: {},
        modifiers: {},
        meta: {},
    },
    meta: asTriggerRecord(row.meta),
    turnTime: row.turnTime,
    recentWarTime: row.recentWarTime ?? null,
});

const mapCityRow = (row: TurnEngineCityRow): City => {
    const meta = asTriggerRecord(row.meta);
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
        meta: {
            ...meta,
            trust: row.trust,
            trade: row.trade,
            region: row.region,
        },
    };
};

const mapNationRow = (row: TurnEngineNationRow): Nation => ({
    id: row.id,
    name: row.name,
    color: row.color,
    capitalCityId: row.capitalCityId,
    chiefGeneralId: null,
    gold: row.gold,
    rice: row.rice,
    power: 0,
    level: row.level,
    typeCode: row.typeCode,
    meta: {
        ...asTriggerRecord(row.meta),
        tech: row.tech,
    },
});

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

        const [generalRows, cityRows, nationRows, diplomacyRows, troopRows, eventRows] = await Promise.all([
            prisma.general.findMany(),
            prisma.city.findMany(),
            prisma.nation.findMany(),
            prisma.diplomacy.findMany(),
            prisma.troop.findMany(),
            prisma.event.findMany({
                orderBy: [{ priority: 'desc' }, { id: 'asc' }],
            }),
        ]);

        const generals = generalRows.map(mapGeneralRow);
        const cities = cityRows.map(mapCityRow);
        const nations = nationRows.map(mapNationRow);
        const diplomacy = diplomacyRows.map(mapDiplomacyRow);
        const troops = troopRows.map(mapTroopRow);

        const scenarioConfig = mapScenarioConfig(worldState.config);
        const mapName = scenarioConfig.environment?.mapName ?? 'che';
        const map = await loadMapDefinitionByName(mapName, options.mapOptions);
        const unitSetName = scenarioConfig.environment?.unitSet ?? 'che';
        const unitSet = await loadUnitSetDefinitionByName(unitSetName, options.unitSetOptions);

        const meta = asRecord(worldState.meta);
        const scenarioMeta = parseScenarioMeta(meta);

        const tickMinutes = Math.max(1, Math.round(worldState.tickSeconds / 60));
        const fallbackBase = resolveFallbackTurnTimeBase(generals, worldState.updatedAt ?? null);
        const lastTurnTime = parseLastTurnTime(meta) ?? alignToPreviousTick(fallbackBase, tickMinutes);

        const events = eventRows
            .filter((row) => row.targetCode !== 'initial')
            .map((row) => ({
                id: row.id,
                targetCode: row.targetCode,
                priority: row.priority,
                condition: row.condition,
                action: row.action,
                meta: row.meta,
            }));
        const initialEvents = eventRows
            .filter((row) => row.targetCode === 'initial')
            .map((row) => ({
                id: row.id,
                targetCode: row.targetCode,
                priority: row.priority,
                condition: row.condition,
                action: row.action,
                meta: row.meta,
            }));

        return {
            state: {
                id: worldState.id,
                currentYear: worldState.currentYear,
                currentMonth: worldState.currentMonth,
                tickSeconds: worldState.tickSeconds,
                lastTurnTime,
                meta,
            },
            snapshot: {
                scenarioConfig,
                ...(scenarioMeta ? { scenarioMeta } : {}),
                map,
                unitSet,
                nations,
                cities,
                generals,
                troops,
                diplomacy,
                events,
                initialEvents,
            },
        };
    } finally {
        await connector.disconnect();
    }
};
