import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import type {
    City,
    General,
    GeneralMeta,
    GeneralTriggerState,
    Nation,
    TriggerValue,
} from '@sammo-ts/logic/domain/entities.js';
import type { ScenarioDefinition, ScenarioGeneral } from '@sammo-ts/logic/scenario/types.js';
import type {
    CitySeed,
    GeneralSeed,
    MapDefaults,
    MapDefinition,
    NationSeed,
    ScenarioMeta,
    UnitSetDefinition,
    WorldSeedPayload,
    WorldSnapshot,
} from './types.js';
import { simpleSerialize } from '../war/utils.js';

export interface ScenarioBootstrapOptions {
    includeNeutralNation?: boolean;
    includeNeutralNationInSeed?: boolean;
    neutralNationName?: string;
    neutralNationColor?: string;
    defaultGeneralGold?: number;
    defaultGeneralRice?: number;
    defaultCrewTypeId?: number;
    nationTypePrefix?: string;
    mapDefaults?: Partial<MapDefaults>;
    /**
     * Legacy scenario installation uses the world's hidden seed while resolving
     * generals whose city is omitted. Keep this input explicit so bootstrap
     * remains deterministic in tests and reset operations.
     */
    hiddenSeed?: string | number;
}

export type ScenarioBootstrapWarningCode =
    | 'map_name_mismatch'
    | 'unit_set_mismatch'
    | 'duplicate_city_name'
    | 'unknown_city'
    | 'duplicate_city_owner'
    | 'unknown_general_city'
    | 'unknown_general_nation';

export interface ScenarioBootstrapWarning {
    code: ScenarioBootstrapWarningCode;
    message: string;
}

export interface ScenarioBootstrapInput {
    scenario: ScenarioDefinition;
    map: MapDefinition;
    unitSet?: UnitSetDefinition;
    options?: ScenarioBootstrapOptions;
}

export interface ScenarioBootstrapResult {
    snapshot: WorldSnapshot;
    seed: WorldSeedPayload;
    warnings: ScenarioBootstrapWarning[];
}

const DEFAULT_NEUTRAL_NATION_NAME = '재야';
const DEFAULT_NEUTRAL_NATION_COLOR = '#000000';
const DEFAULT_GENERAL_GOLD = 1000;
const DEFAULT_GENERAL_RICE = 1000;
const DEFAULT_CREWTYPE_ID = 1100;
const DEFAULT_GENERAL_KILLTURN = 24;
const DEFAULT_CITY_TRUST = 50;
const DEFAULT_CITY_TRADE = 100;
const DEFAULT_CITY_SUPPLY_STATE = 1;
const DEFAULT_CITY_FRONT_STATE = 0;

const createScenarioMeta = (scenario: ScenarioDefinition): ScenarioMeta => ({
    title: scenario.title,
    startYear: scenario.startYear,
    life: scenario.life,
    fiction: scenario.fiction,
    history: scenario.history,
    ignoreDefaultEvents: scenario.ignoreDefaultEvents,
});

const createEmptyTriggerState = (): GeneralTriggerState => ({
    flags: {},
    counters: {},
    modifiers: {},
    meta: {},
});

const addTriggerMeta = (
    meta: Record<string, TriggerValue>,
    key: string,
    value: TriggerValue | null | undefined
): void => {
    if (value === null || value === undefined) {
        return;
    }
    meta[key] = value;
};

const resolveMapDefaults = (map: MapDefinition, options?: ScenarioBootstrapOptions): MapDefaults => {
    const override = options?.mapDefaults ?? {};
    return {
        trust: override.trust ?? map.defaults?.trust ?? DEFAULT_CITY_TRUST,
        trade: override.trade ?? map.defaults?.trade ?? DEFAULT_CITY_TRADE,
        supplyState: override.supplyState ?? map.defaults?.supplyState ?? DEFAULT_CITY_SUPPLY_STATE,
        frontState: override.frontState ?? map.defaults?.frontState ?? DEFAULT_CITY_FRONT_STATE,
    };
};

const resolveNationType = (rawType: string, prefix: string): string => {
    const trimmed = rawType.trim();
    if (!trimmed) {
        return `${prefix}중립`;
    }
    if (trimmed.includes('_')) {
        return trimmed;
    }
    return `${prefix}${trimmed}`;
};

const resolveBirthYear = (birthYear: number, startYear: number | null): number => {
    if (birthYear > 0) {
        return birthYear;
    }
    if (startYear !== null) {
        return startYear - 20;
    }
    return 0;
};

const resolveDeathYear = (deathYear: number, birthYear: number, startYear: number | null): number => {
    if (deathYear > 0) {
        return deathYear;
    }
    if (birthYear > 0) {
        return birthYear + 60;
    }
    if (startYear !== null) {
        return startYear + 60;
    }
    return 0;
};

const resolveKillturnFromDeathYear = (
    currentYear: number | null,
    currentMonth: number,
    deathYear: number,
    deathMonth: number,
    fallback: number
): number => {
    if (currentYear === null || !Number.isFinite(deathYear) || deathYear <= 0) {
        return fallback;
    }
    const diff = (deathYear - currentYear) * 12 + (deathMonth - currentMonth);
    return Math.max(diff, 0);
};

export const resolveScenarioGeneralDeathMonth = (input: {
    scenarioTitle: string;
    startYear: number | null;
    contextLabel: string;
    generalId: number;
    generalName: string;
    deathYear: number;
}): number =>
    new RandUtil(
        new LiteHashDRBG(
            simpleSerialize(
                input.scenarioTitle,
                input.startYear ?? 0,
                input.contextLabel,
                input.generalId,
                input.generalName,
                input.deathYear,
                'deathMonth'
            )
        )
    ).nextRangeInt(1, 12);

const resolveAge = (startYear: number | null, birthYear: number): number => {
    if (startYear === null || birthYear <= 0) {
        return 20;
    }
    return Math.max(startYear - birthYear, 0);
};

const buildSpecialityAge = (retirementYear: number, age: number, divisor: number): number =>
    Math.max(Math.round((retirementYear - age) / divisor), 3) + age;

const ADULT_GENERAL_AGE = 14;

type GeneralBootstrapDisposition = 'active' | 'delayed' | 'expired';

const resolveGeneralBootstrapDisposition = (
    general: ScenarioGeneral,
    startYear: number | null
): GeneralBootstrapDisposition => {
    if (startYear === null) {
        return 'active';
    }
    if (general.deathYear <= startYear) {
        return 'expired';
    }
    if (startYear - general.birthYear < ADULT_GENERAL_AGE) {
        return 'delayed';
    }
    return 'active';
};

const buildDelayedGeneralAction = (general: ScenarioGeneral, nationId: number, npcType: 2 | 6): unknown[] => {
    const common = [
        general.affinity ?? 0,
        general.name,
        general.picture,
        nationId,
        general.city,
        general.leadership,
        general.strength,
        general.intelligence,
    ];
    if (npcType === 2) {
        return [
            'RegNPC',
            ...common,
            general.officerLevel,
            general.birthYear,
            general.deathYear,
            general.personality,
            general.special,
            general.text ?? '',
        ];
    }
    return [
        'RegNeutralNPC',
        ...common,
        general.birthYear,
        general.deathYear,
        general.personality,
        general.special,
        general.text ?? '',
    ];
};

const resolveOfficerLevel = (officerLevel: number, nationId: number): number => {
    if (officerLevel > 0) {
        return officerLevel;
    }
    if (nationId > 0) {
        return 1;
    }
    return 0;
};

const resolveNationId = (
    rawNation: number | string | null,
    nationNameToId: Map<string, number>,
    warnings: ScenarioBootstrapWarning[],
    generalName: string
): number => {
    if (rawNation === null) {
        return 0;
    }
    if (typeof rawNation === 'number') {
        return rawNation;
    }
    const nationId = nationNameToId.get(rawNation);
    if (nationId === undefined) {
        warnings.push({
            code: 'unknown_general_nation',
            message: `General ${generalName} references unknown nation ${rawNation}.`,
        });
        return 0;
    }
    return nationId;
};

const resolveCityId = (
    rawCity: string | null,
    cityByName: Map<string, { id: number }>,
    warnings: ScenarioBootstrapWarning[],
    generalName: string
): number => {
    if (rawCity === null) {
        return 0;
    }
    const city = cityByName.get(rawCity);
    if (!city) {
        warnings.push({
            code: 'unknown_general_city',
            message: `General ${generalName} references unknown city ${rawCity}.`,
        });
        return 0;
    }
    return city.id;
};

const buildGeneralSeeds = (
    rows: ScenarioGeneral[],
    npcType: number,
    startId: number,
    contextLabel: string,
    scenario: ScenarioDefinition,
    cityByName: Map<string, { id: number }>,
    nationNameToId: Map<string, number>,
    warnings: ScenarioBootstrapWarning[],
    defaultCrewTypeId: number,
    mapCities: MapDefinition['cities'],
    nationCityIds: Map<number, number[]>,
    placementRng: RandUtil,
    options?: ScenarioBootstrapOptions
): {
    seeds: GeneralSeed[];
    generals: General[];
    nextId: number;
} => {
    const seeds: GeneralSeed[] = [];
    const generals: General[] = [];
    let nextId = startId;

    const defaultGold = options?.defaultGeneralGold ?? DEFAULT_GENERAL_GOLD;
    const defaultRice = options?.defaultGeneralRice ?? DEFAULT_GENERAL_RICE;
    const rawRetirementYear = scenario.config.const.retirementYear;
    const retirementYear =
        typeof rawRetirementYear === 'number' && Number.isFinite(rawRetirementYear) ? rawRetirementYear : 80;

    for (const row of rows) {
        const id = nextId;
        nextId += 1;

        const nationId = resolveNationId(row.nation, nationNameToId, warnings, row.name);
        let cityId = resolveCityId(row.city, cityByName, warnings, row.name);
        if (row.city === null) {
            const ownedCityIds = nationId > 0 ? (nationCityIds.get(nationId) ?? []) : [];
            const candidateCityIds = ownedCityIds.length > 0 ? ownedCityIds : mapCities.map((city) => city.id);
            if (candidateCityIds.length > 0) {
                cityId = placementRng.choice(candidateCityIds);
            }
        }
        const birthYear = resolveBirthYear(row.birthYear, scenario.startYear);
        const deathYear = resolveDeathYear(row.deathYear, birthYear, scenario.startYear);
        const deathMonth = resolveScenarioGeneralDeathMonth({
            scenarioTitle: scenario.title,
            startYear: scenario.startYear,
            contextLabel,
            generalId: id,
            generalName: row.name,
            deathYear,
        });
        const officerLevel = resolveOfficerLevel(row.officerLevel, nationId);
        const age = resolveAge(scenario.startYear, birthYear);
        const stats = {
            leadership: row.leadership,
            strength: row.strength,
            intelligence: row.intelligence,
        };

        const seedMeta: Record<string, unknown> = {
            source: contextLabel,
            deathMonth,
            specage: buildSpecialityAge(retirementYear, age, 12),
            specage2: buildSpecialityAge(retirementYear, age, 6),
        };
        if (row.affinity !== null) {
            seedMeta.affinity = row.affinity;
        }
        if (row.personality !== null) {
            seedMeta.personality = row.personality;
        }
        if (row.special !== null) {
            seedMeta.special = row.special;
        }
        if (row.picture !== null) {
            seedMeta.picture = row.picture;
        }
        if (row.specialWar !== null && row.specialWar !== undefined) {
            seedMeta.specialWar = row.specialWar;
        }
        if (row.horse !== null && row.horse !== undefined) {
            seedMeta.horse = row.horse;
        }
        if (row.weapon !== null && row.weapon !== undefined) {
            seedMeta.weapon = row.weapon;
        }
        if (row.book !== null && row.book !== undefined) {
            seedMeta.book = row.book;
        }
        if (row.item !== null && row.item !== undefined) {
            seedMeta.item = row.item;
        }
        if (row.text !== null) {
            seedMeta.text = row.text;
        }

        const seed: GeneralSeed = {
            id,
            name: row.name,
            nationId,
            cityId,
            stats,
            officerLevel,
            birthYear,
            deathYear,
            affinity: row.affinity,
            personality: row.personality,
            special: row.special,
            specialWar: row.specialWar ?? null,
            horse: row.horse ?? null,
            weapon: row.weapon ?? null,
            book: row.book ?? null,
            item: row.item ?? null,
            picture: row.picture,
            npcType,
            text: row.text,
            crewTypeId: defaultCrewTypeId,
            meta: seedMeta,
        };
        seeds.push(seed);

        const generalMeta: GeneralMeta = {
            killturn: resolveKillturnFromDeathYear(
                scenario.startYear,
                1,
                deathYear,
                deathMonth,
                DEFAULT_GENERAL_KILLTURN
            ),
            deathMonth,
            npcType,
            crewTypeId: defaultCrewTypeId,
            specage: buildSpecialityAge(retirementYear, age, 12),
            specage2: buildSpecialityAge(retirementYear, age, 6),
        };
        addTriggerMeta(generalMeta, 'affinity', row.affinity);
        addTriggerMeta(generalMeta, 'personality', row.personality ?? undefined);
        addTriggerMeta(generalMeta, 'special', row.special ?? undefined);
        addTriggerMeta(generalMeta, 'picture', row.picture ?? undefined);
        addTriggerMeta(generalMeta, 'specialWar', row.specialWar ?? undefined);
        addTriggerMeta(generalMeta, 'horse', row.horse ?? undefined);
        addTriggerMeta(generalMeta, 'weapon', row.weapon ?? undefined);
        addTriggerMeta(generalMeta, 'book', row.book ?? undefined);
        addTriggerMeta(generalMeta, 'item', row.item ?? undefined);
        addTriggerMeta(generalMeta, 'birthYear', birthYear);
        addTriggerMeta(generalMeta, 'text', row.text ?? undefined);

        generals.push({
            id,
            name: row.name,
            nationId,
            cityId,
            troopId: 0,
            stats,
            experience: 0,
            dedication: 0,
            officerLevel,
            role: {
                personality: row.personality,
                specialDomestic: row.special,
                specialWar: row.specialWar ?? null,
                items: {
                    horse: row.horse ?? null,
                    weapon: row.weapon ?? null,
                    book: row.book ?? null,
                    item: row.item ?? null,
                },
            },
            injury: 0,
            gold: defaultGold,
            rice: defaultRice,
            crew: 0,
            crewTypeId: defaultCrewTypeId,
            train: 0,
            atmos: 0,
            age,
            npcState: npcType,
            triggerState: createEmptyTriggerState(),
            meta: generalMeta,
        });
    }

    return { seeds, generals, nextId };
};

// 시나리오, 맵, 유닛셋을 묶어 초기 월드 스냅샷과 시드 데이터를 만든다.
export const buildScenarioBootstrap = (input: ScenarioBootstrapInput): ScenarioBootstrapResult => {
    const { scenario, map, unitSet, options } = input;
    const warnings: ScenarioBootstrapWarning[] = [];

    const environment = scenario.config.environment;
    if (map.id !== environment.mapName && map.name !== environment.mapName) {
        warnings.push({
            code: 'map_name_mismatch',
            message: `Scenario mapName ${environment.mapName} does not match map definition ${map.id}.`,
        });
    }
    if (unitSet && unitSet.id !== environment.unitSet && unitSet.name !== environment.unitSet) {
        warnings.push({
            code: 'unit_set_mismatch',
            message: `Scenario unitSet ${environment.unitSet} does not match unit set ${unitSet.id}.`,
        });
    }

    const cityByName = new Map<string, { id: number }>();
    for (const city of map.cities) {
        if (cityByName.has(city.name)) {
            warnings.push({
                code: 'duplicate_city_name',
                message: `Duplicate city name detected: ${city.name}.`,
            });
            continue;
        }
        cityByName.set(city.name, city);
    }

    const nationNameToId = new Map<string, number>();
    for (const nation of scenario.nations) {
        nationNameToId.set(nation.name, nation.id);
    }

    const cityOwnership = new Map<number, number>();
    const nationCityIds = new Map<number, number[]>();

    for (const nation of scenario.nations) {
        const cityIds: number[] = [];
        for (const cityName of nation.cities) {
            const city = cityByName.get(cityName);
            if (!city) {
                warnings.push({
                    code: 'unknown_city',
                    message: `Nation ${nation.name} references unknown city ${cityName}.`,
                });
                continue;
            }
            const existing = cityOwnership.get(city.id);
            if (existing !== undefined && existing !== nation.id) {
                warnings.push({
                    code: 'duplicate_city_owner',
                    message: `City ${cityName} is already assigned to nation ${existing}.`,
                });
            }
            cityOwnership.set(city.id, nation.id);
            cityIds.push(city.id);
        }
        nationCityIds.set(nation.id, cityIds);
    }

    const scenarioMeta = createScenarioMeta(scenario);
    const typePrefix = options?.nationTypePrefix ?? `${environment.mapName}_`;

    const seedNations: NationSeed[] = [];
    const domainNations: Nation[] = [];

    const includeNeutralNation = options?.includeNeutralNation ?? true;
    const includeNeutralNationInSeed = options?.includeNeutralNationInSeed ?? false;
    if (includeNeutralNation) {
        const neutralNation: Nation = {
            id: 0,
            name: options?.neutralNationName ?? DEFAULT_NEUTRAL_NATION_NAME,
            color: options?.neutralNationColor ?? DEFAULT_NEUTRAL_NATION_COLOR,
            capitalCityId: null,
            chiefGeneralId: null,
            gold: 0,
            rice: 0,
            power: 0,
            level: 0,
            typeCode: `${typePrefix}중립`,
            meta: {},
        };
        domainNations.push(neutralNation);
        if (includeNeutralNationInSeed) {
            seedNations.push({
                id: neutralNation.id,
                name: neutralNation.name,
                color: neutralNation.color,
                gold: neutralNation.gold,
                rice: neutralNation.rice,
                infoText: null,
                tech: 0,
                typeCode: neutralNation.typeCode,
                level: neutralNation.level,
                cityIds: [],
                capitalCityId: null,
                meta: {},
            });
        }
    }

    for (const nation of scenario.nations) {
        const cityIds = nationCityIds.get(nation.id) ?? [];
        const capitalCityId = cityIds[0] ?? null;
        const typeCode = resolveNationType(nation.type, typePrefix);

        seedNations.push({
            id: nation.id,
            name: nation.name,
            color: nation.color,
            gold: nation.gold,
            rice: nation.rice,
            infoText: nation.infoText,
            tech: nation.tech,
            typeCode,
            level: nation.level,
            cityIds,
            capitalCityId,
            meta: {},
        });

        const nationMeta: Record<string, TriggerValue> = {
            tech: nation.tech,
        };
        addTriggerMeta(nationMeta, 'infoText', nation.infoText ?? undefined);

        domainNations.push({
            id: nation.id,
            name: nation.name,
            color: nation.color,
            capitalCityId,
            chiefGeneralId: null,
            gold: nation.gold,
            rice: nation.rice,
            power: 0,
            level: nation.level,
            typeCode,
            meta: nationMeta,
        });
    }

    const mapDefaults = resolveMapDefaults(map, options);
    const placementRng = new RandUtil(
        new LiteHashDRBG(simpleSerialize(options?.hiddenSeed ?? scenario.title, 'InitScenarioGeneralCities'))
    );
    const defaultCrewTypeId = unitSet?.defaultCrewTypeId ?? options?.defaultCrewTypeId ?? DEFAULT_CREWTYPE_ID;
    const seedCities: CitySeed[] = [];
    const domainCities: City[] = [];

    for (const city of map.cities) {
        const nationId = cityOwnership.get(city.id) ?? 0;
        const rawCityMeta = city.meta ?? {};
        const state =
            typeof rawCityMeta.state === 'number' && Number.isFinite(rawCityMeta.state)
                ? Math.floor(rawCityMeta.state)
                : 0;
        const seed: CitySeed = {
            id: city.id,
            name: city.name,
            nationId,
            level: city.level,
            state,
            population: city.initial.population,
            populationMax: city.max.population,
            agriculture: city.initial.agriculture,
            agricultureMax: city.max.agriculture,
            commerce: city.initial.commerce,
            commerceMax: city.max.commerce,
            security: city.initial.security,
            securityMax: city.max.security,
            defence: city.initial.defence,
            defenceMax: city.max.defence,
            wall: city.initial.wall,
            wallMax: city.max.wall,
            supplyState: mapDefaults.supplyState,
            frontState: mapDefaults.frontState,
            trust: mapDefaults.trust,
            trade: mapDefaults.trade,
            region: city.region,
            position: city.position,
            connections: city.connections,
            meta: {
                ...rawCityMeta,
                state,
            },
        };
        seedCities.push(seed);

        const cityTriggerMeta: Record<string, TriggerValue> = {
            region: city.region,
            trust: seed.trust,
            trade: seed.trade,
            positionX: city.position.x,
            positionY: city.position.y,
        };

        domainCities.push({
            id: seed.id,
            name: seed.name,
            nationId: seed.nationId,
            level: seed.level,
            state,
            population: seed.population,
            populationMax: seed.populationMax,
            agriculture: seed.agriculture,
            agricultureMax: seed.agricultureMax,
            commerce: seed.commerce,
            commerceMax: seed.commerceMax,
            security: seed.security,
            securityMax: seed.securityMax,
            supplyState: seed.supplyState,
            frontState: seed.frontState,
            defence: seed.defence,
            defenceMax: seed.defenceMax,
            wall: seed.wall,
            wallMax: seed.wallMax,
            meta: cityTriggerMeta,
        });
    }

    let nextGeneralId = 1;
    const allGeneralSeeds: GeneralSeed[] = [];
    const allGenerals: General[] = [];
    const delayedActionsByBirthYear = new Map<number, unknown[][]>();

    const partitionGenerals = (rows: ScenarioGeneral[], npcType: 2 | 6): ScenarioGeneral[] => {
        const active: ScenarioGeneral[] = [];
        for (const general of rows) {
            const disposition = resolveGeneralBootstrapDisposition(general, scenario.startYear);
            if (disposition === 'active') {
                active.push(general);
                continue;
            }
            if (disposition === 'expired') {
                continue;
            }
            const nationId = resolveNationId(general.nation, nationNameToId, warnings, general.name);
            const actions = delayedActionsByBirthYear.get(general.birthYear) ?? [];
            actions.push(buildDelayedGeneralAction(general, nationId, npcType));
            delayedActionsByBirthYear.set(general.birthYear, actions);
        }
        return active;
    };

    const activeGenerals = partitionGenerals(scenario.generals, 2);
    const activeGeneralsEx = partitionGenerals(scenario.generalsEx, 2);
    const activeGeneralsNeutral = partitionGenerals(scenario.generalsNeutral, 6);

    const generalResult = buildGeneralSeeds(
        activeGenerals,
        2,
        nextGeneralId,
        'general',
        scenario,
        cityByName,
        nationNameToId,
        warnings,
        defaultCrewTypeId,
        map.cities,
        nationCityIds,
        placementRng,
        options
    );
    allGeneralSeeds.push(...generalResult.seeds);
    allGenerals.push(...generalResult.generals);
    nextGeneralId = generalResult.nextId;

    const generalExResult = buildGeneralSeeds(
        activeGeneralsEx,
        2,
        nextGeneralId,
        'general_ex',
        scenario,
        cityByName,
        nationNameToId,
        warnings,
        defaultCrewTypeId,
        map.cities,
        nationCityIds,
        placementRng,
        options
    );
    allGeneralSeeds.push(...generalExResult.seeds);
    allGenerals.push(...generalExResult.generals);
    nextGeneralId = generalExResult.nextId;

    const generalNeutralResult = buildGeneralSeeds(
        activeGeneralsNeutral,
        6,
        nextGeneralId,
        'general_neutral',
        scenario,
        cityByName,
        nationNameToId,
        warnings,
        defaultCrewTypeId,
        map.cities,
        nationCityIds,
        placementRng,
        options
    );
    allGeneralSeeds.push(...generalNeutralResult.seeds);
    allGenerals.push(...generalNeutralResult.generals);

    const delayedGeneralEvents = Array.from(delayedActionsByBirthYear.entries()).map(([birthYear, actions]) => [
        'Month',
        1_000,
        ['Date', '>=', birthYear + ADULT_GENERAL_AGE, 1],
        ...actions,
        ['DeleteEvent'],
    ]);
    const events = [...scenario.events, ...delayedGeneralEvents];

    const seed: WorldSeedPayload = {
        scenarioConfig: scenario.config,
        scenarioMeta,
        map,
        ...(unitSet ? { unitSet } : {}),
        nations: seedNations,
        cities: seedCities,
        generals: allGeneralSeeds,
        troops: [],
        diplomacy: scenario.diplomacy,
        events,
        initialEvents: scenario.initialEvents,
    };

    const snapshot: WorldSnapshot = {
        scenarioConfig: scenario.config,
        scenarioMeta,
        map,
        ...(unitSet ? { unitSet } : {}),
        nations: domainNations,
        cities: domainCities,
        generals: allGenerals,
        troops: [],
        diplomacy: scenario.diplomacy,
        events,
        initialEvents: scenario.initialEvents,
    };

    return { snapshot, seed, warnings };
};
