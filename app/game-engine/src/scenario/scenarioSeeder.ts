import { createGamePostgresConnector, type InputJsonValue, type TurnEngineEventCreateManyInput } from '@sammo-ts/infra';
import { buildScenarioBootstrap, type ScenarioBootstrapWarning, type WorldSeedPayload } from '@sammo-ts/logic';

import type { MapLoaderOptions } from './mapLoader.js';
import { loadMapDefinitionByName } from './mapLoader.js';
import type { ScenarioLoaderOptions } from './scenarioLoader.js';
import { loadScenarioDefinitionById } from './scenarioLoader.js';
import type { UnitSetLoaderOptions } from './unitSetLoader.js';
import { loadUnitSetDefinitionByName } from './unitSetLoader.js';

const DEFAULT_TICK_SECONDS = 120 * 60;
const DEFAULT_GENERAL_GOLD = 1000;
const DEFAULT_GENERAL_RICE = 1000;

export interface ScenarioSeedOptions {
    scenarioId: number;
    databaseUrl: string;
    scenarioOptions?: ScenarioLoaderOptions;
    mapOptions?: MapLoaderOptions;
    unitSetOptions?: UnitSetLoaderOptions;
    resetTables?: boolean;
    now?: Date;
    tickSeconds?: number;
    includeNeutralNationInSeed?: boolean;
    defaultGeneralGold?: number;
    defaultGeneralRice?: number;
}

export interface ScenarioSeedResult {
    seed: WorldSeedPayload;
    warnings: ScenarioBootstrapWarning[];
}

const asJson = (value: unknown): InputJsonValue => value as InputJsonValue;

const resolveGeneralAge = (startYear: number | null, birthYear: number): number => {
    if (startYear === null || birthYear <= 0) {
        return 20;
    }
    return Math.max(startYear - birthYear, 0);
};

const buildEventRows = (rows: unknown[], targetOverride?: string): TurnEngineEventCreateManyInput[] => {
    const result: TurnEngineEventCreateManyInput[] = [];

    for (const row of rows) {
        if (!Array.isArray(row)) {
            continue;
        }
        if (targetOverride) {
            const [condition, ...actions] = row;
            result.push({
                targetCode: targetOverride,
                priority: 0,
                condition: asJson(condition ?? null),
                action: asJson(actions),
                meta: asJson({ source: targetOverride }),
            });
            continue;
        }

        const [target, priority, condition, ...actions] = row;
        if (typeof target !== 'string' || typeof priority !== 'number') {
            continue;
        }
        result.push({
            targetCode: target,
            priority,
            condition: asJson(condition ?? null),
            action: asJson(actions),
            meta: asJson({ source: 'scenario' }),
        });
    }

    return result;
};

// 시나리오 초기 데이터를 로드해 DB에 저장한다.
export const seedScenarioToDatabase = async (options: ScenarioSeedOptions): Promise<ScenarioSeedResult> => {
    const scenario = await loadScenarioDefinitionById(options.scenarioId, options.scenarioOptions);
    const map = await loadMapDefinitionByName(scenario.config.environment.mapName, options.mapOptions);
    const unitSet = await loadUnitSetDefinitionByName(scenario.config.environment.unitSet, options.unitSetOptions);

    const { seed, warnings } = buildScenarioBootstrap({
        scenario,
        map,
        unitSet,
        options: {
            includeNeutralNationInSeed: options.includeNeutralNationInSeed ?? true,
        },
    });

    const connector = createGamePostgresConnector({ url: options.databaseUrl });
    const now = options.now ?? new Date();
    const tickSeconds = options.tickSeconds ?? DEFAULT_TICK_SECONDS;
    const generalGold = options.defaultGeneralGold ?? DEFAULT_GENERAL_GOLD;
    const generalRice = options.defaultGeneralRice ?? DEFAULT_GENERAL_RICE;

    await connector.connect();
    try {
        const prisma = connector.prisma;

        if (options.resetTables ?? true) {
            await prisma.event.deleteMany();
            await prisma.diplomacy.deleteMany();
            await prisma.general.deleteMany();
            await prisma.troop.deleteMany();
            await prisma.city.deleteMany();
            await prisma.nation.deleteMany();
            await prisma.worldState.deleteMany();
        }

        await prisma.worldState.create({
            data: {
                scenarioCode: String(options.scenarioId),
                currentYear: scenario.startYear ?? 0,
                currentMonth: 1,
                tickSeconds,
                config: asJson(seed.scenarioConfig),
                meta: asJson({
                    scenarioId: options.scenarioId,
                    scenarioMeta: seed.scenarioMeta,
                }),
            },
        });

        if (seed.nations.length > 0) {
            await prisma.nation.createMany({
                data: seed.nations.map((nation) => ({
                    id: nation.id,
                    name: nation.name,
                    color: nation.color,
                    capitalCityId: nation.capitalCityId ?? null,
                    gold: nation.gold,
                    rice: nation.rice,
                    tech: nation.tech,
                    level: nation.level,
                    typeCode: nation.typeCode,
                    meta: asJson({
                        infoText: nation.infoText,
                        cityIds: nation.cityIds,
                    }),
                })),
            });
        }

        if (seed.cities.length > 0) {
            await prisma.city.createMany({
                data: seed.cities.map((city) => ({
                    id: city.id,
                    name: city.name,
                    level: city.level,
                    nationId: city.nationId,
                    supplyState: city.supplyState,
                    frontState: city.frontState,
                    population: city.population,
                    populationMax: city.populationMax,
                    agriculture: city.agriculture,
                    agricultureMax: city.agricultureMax,
                    commerce: city.commerce,
                    commerceMax: city.commerceMax,
                    security: city.security,
                    securityMax: city.securityMax,
                    trust: city.trust,
                    trade: city.trade,
                    defence: city.defence,
                    defenceMax: city.defenceMax,
                    wall: city.wall,
                    wallMax: city.wallMax,
                    region: city.region,
                    conflict: asJson({}),
                    meta: asJson({
                        position: city.position,
                        connections: city.connections,
                        state: city.state,
                        ...city.meta,
                    }),
                })),
            });
        }

        if (seed.generals.length > 0) {
            await prisma.general.createMany({
                data: seed.generals.map((general) => ({
                    id: general.id,
                    name: general.name,
                    nationId: general.nationId,
                    cityId: general.cityId,
                    npcState: general.npcType,
                    affinity: general.affinity,
                    bornYear: general.birthYear,
                    deadYear: general.deathYear,
                    picture: general.picture === null ? null : String(general.picture),
                    leadership: general.stats.leadership,
                    strength: general.stats.strength,
                    intel: general.stats.intelligence,
                    officerLevel: general.officerLevel,
                    gold: generalGold,
                    rice: generalRice,
                    crewTypeId: general.crewTypeId,
                    horseCode: general.horse ?? 'None',
                    weaponCode: general.weapon ?? 'None',
                    bookCode: general.book ?? 'None',
                    itemCode: general.item ?? 'None',
                    turnTime: now,
                    age: resolveGeneralAge(scenario.startYear ?? null, general.birthYear),
                    personalCode: general.personality ?? 'None',
                    specialCode: general.special ?? 'None',
                    special2Code: general.specialWar ?? 'None',
                    lastTurn: asJson({}),
                    meta: asJson({
                        npcType: general.npcType,
                        crewTypeId: general.crewTypeId,
                        ...general.meta,
                    }),
                    penalty: asJson({}),
                })),
            });
        }

        if (seed.troops.length > 0) {
            await prisma.troop.createMany({
                data: seed.troops.map((troop) => ({
                    troopLeaderId: troop.id,
                    nationId: troop.nationId,
                    name: troop.name,
                })),
            });
        }

        const diplomacyMap = new Map<
            string,
            { srcNationId: number; destNationId: number; state: number; term: number }
        >();
        const nationIds = seed.nations.map((nation) => nation.id);
        for (const srcNationId of nationIds) {
            for (const destNationId of nationIds) {
                if (srcNationId === destNationId) {
                    continue;
                }
                diplomacyMap.set(`${srcNationId}:${destNationId}`, {
                    srcNationId,
                    destNationId,
                    state: 2,
                    term: 0,
                });
            }
        }
        for (const row of seed.diplomacy) {
            diplomacyMap.set(`${row.fromNationId}:${row.toNationId}`, {
                srcNationId: row.fromNationId,
                destNationId: row.toNationId,
                state: row.state,
                term: row.durationMonths,
            });
            diplomacyMap.set(`${row.toNationId}:${row.fromNationId}`, {
                srcNationId: row.toNationId,
                destNationId: row.fromNationId,
                state: row.state,
                term: row.durationMonths,
            });
        }
        const diplomacyRows = Array.from(diplomacyMap.values());
        if (diplomacyRows.length > 0) {
            await prisma.diplomacy.createMany({
                data: diplomacyRows.map((row) => ({
                    srcNationId: row.srcNationId,
                    destNationId: row.destNationId,
                    stateCode: row.state,
                    term: row.term,
                    meta: asJson({}),
                })),
            });
        }

        const eventRows = [...buildEventRows(seed.events), ...buildEventRows(seed.initialEvents, 'initial')];
        if (eventRows.length > 0) {
            await prisma.event.createMany({
                data: eventRows,
            });
        }
    } finally {
        await connector.disconnect();
    }

    return { seed, warnings };
};
