import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asNumber, asRecord } from '@sammo-ts/common';
import {
    DomesticTraitLoader,
    loadDomesticTraitModules,
    isDomesticTraitKey,
    loadNationTraitModules,
    NationTraitLoader,
    isNationTraitKey,
    loadPersonalityTraitModules,
    PersonalityTraitLoader,
    isPersonalityTraitKey,
    loadWarTraitModules,
    WarTraitLoader,
    isWarTraitKey,
    type GeneralActionContext,
    type General as LogicGeneral,
    type Nation as LogicNation,
    type TriggerValue,
} from '@sammo-ts/logic';

import type { WorldStateRow } from '../../context.js';
import { authedProcedure, router } from '../../trpc.js';
import { MAX_NATION_TURNS, listNationTurns } from '../../turns/reservedTurns.js';
import { getMyGeneral } from '../shared/general.js';
import { resolveSecretPermission } from '../shared/secretPermission.js';

type PermissionKind = 'normal' | 'ambassador' | 'auditor';

type TraitNameMap = Map<string, { name: string; info: string }>;

type TraitCache = {
    domestic: TraitNameMap;
    war: TraitNameMap;
    personality: TraitNameMap;
    nation: TraitNameMap;
};

type NationTraitModule = Awaited<ReturnType<typeof loadNationTraitModules>>[number] | null;

type NationIncomeContext = {
    trait: NationTraitModule;
    context: GeneralActionContext;
    rate: number;
};

type NationIncomeRow = {
    id: number;
    name: string;
    color: string;
    capitalCityId: number | null;
    level: number;
    typeCode: string;
    meta: unknown;
    gold?: number;
    rice?: number;
};

type CityIncomeRow = {
    id: number;
    name: string;
    level: number;
    nationId: number;
    region: number;
    population: number;
    populationMax: number;
    agriculture: number;
    agricultureMax: number;
    commerce: number;
    commerceMax: number;
    security: number;
    securityMax: number;
    trust: number;
    trade: number;
    defence: number;
    defenceMax: number;
    wall: number;
    wallMax: number;
    supplyState: number;
    frontState: number;
    meta: unknown;
};

type GeneralListRow = {
    id: number;
    name: string;
    npcState: number;
    nationId: number;
    cityId: number;
    troopId: number;
    officerLevel: number;
    leadership: number;
    strength: number;
    intel: number;
    experience: number;
    dedication: number;
    injury: number;
    gold: number;
    rice: number;
    crew: number;
    personalCode: string;
    specialCode: string;
    special2Code: string;
    meta: unknown;
    penalty: unknown;
};

type GeneralOfficerRow = {
    id: number;
    name: string;
    npcState: number;
    officerLevel: number;
    cityId: number;
    leadership: number;
    strength: number;
    intel: number;
    meta: unknown;
};

const traitCache: TraitCache = {
    domestic: new Map(),
    war: new Map(),
    personality: new Map(),
    nation: new Map(),
};

const DEFAULT_CHIEF_STAT_MIN = 65;

const normalizeTraitKey = (value: string | null | undefined): string | null => {
    if (!value || value === 'None') {
        return null;
    }
    return value;
};

const readMetaNumber = (meta: Record<string, unknown>, key: string, fallback: number): number => {
    const raw = meta[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
};

const resolveOfficerCity = (meta: Record<string, unknown>): number => {
    const camel = readMetaNumber(meta, 'officerCity', 0);
    if (camel > 0) {
        return camel;
    }
    return readMetaNumber(meta, 'officer_city', 0);
};

const resolveBelong = (meta: Record<string, unknown>): number => readMetaNumber(meta, 'belong', 0);

const resolvePermission = (meta: Record<string, unknown>): PermissionKind => {
    const value = meta.permission;
    if (value === 'ambassador' || value === 'auditor') {
        return value;
    }
    return 'normal';
};

const resolveChiefStatMin = (worldState: WorldStateRow | null): number => {
    if (!worldState) {
        return DEFAULT_CHIEF_STAT_MIN;
    }
    const config = asRecord(worldState.config);
    const stat = asRecord(config.stat);
    return asNumber(stat.chiefMin, DEFAULT_CHIEF_STAT_MIN);
};

const resolveNationRate = (nation: NationIncomeRow): number => {
    const meta = asRecord(nation.meta);
    return asNumber(meta.rate, 20);
};

const checkSecretMaxPermission = (penalty: Record<string, unknown>): number => {
    if (penalty.noTopSecret) {
        return 1;
    }
    if (penalty.noChief) {
        return 1;
    }
    if (penalty.noAmbassador) {
        return 2;
    }
    return 4;
};

const loadTraitNames = async (
    keys: Array<string | null>,
    kind: keyof TraitCache
): Promise<TraitNameMap> => {
    const cache = traitCache[kind];
    const unique = Array.from(new Set(keys.filter((key): key is string => Boolean(key))));
    const missing = unique.filter((key) => !cache.has(key));

    if (!missing.length) {
        return cache;
    }

    if (kind === 'domestic') {
        const filtered = missing.filter((key) => isDomesticTraitKey(key));
        if (filtered.length) {
            const modules = await loadDomesticTraitModules(filtered, new DomesticTraitLoader());
            for (const module of modules) {
                cache.set(module.key, { name: module.name, info: module.info ?? '' });
            }
        }
    } else if (kind === 'war') {
        const filtered = missing.filter((key) => isWarTraitKey(key));
        if (filtered.length) {
            const modules = await loadWarTraitModules(filtered, new WarTraitLoader());
            for (const module of modules) {
                cache.set(module.key, { name: module.name, info: module.info ?? '' });
            }
        }
    } else if (kind === 'personality') {
        const filtered = missing.filter((key) => isPersonalityTraitKey(key));
        if (filtered.length) {
            const modules = await loadPersonalityTraitModules(filtered, new PersonalityTraitLoader());
            for (const module of modules) {
                cache.set(module.key, { name: module.name, info: module.info ?? '' });
            }
        }
    } else if (kind === 'nation') {
        const filtered = missing.filter((key) => isNationTraitKey(key));
        if (filtered.length) {
            const modules = await loadNationTraitModules(filtered, new NationTraitLoader());
            for (const module of modules) {
                cache.set(module.key, { name: module.name, info: module.info ?? '' });
            }
        }
    }

    return cache;
};

const buildIncomeContext = (nation: NationIncomeRow): GeneralActionContext => {
    const nationMeta = asRecord(nation.meta) as Record<string, TriggerValue>;
    const general: LogicGeneral = {
        id: 0,
        name: 'SYSTEM',
        nationId: nation.id,
        cityId: 0,
        troopId: 0,
        stats: { leadership: 0, strength: 0, intelligence: 0 },
        experience: 0,
        dedication: 0,
        officerLevel: 0,
        role: {
            personality: null,
            specialDomestic: null,
            specialWar: null,
            items: {
                horse: null,
                weapon: null,
                book: null,
                item: null,
            },
        },
        injury: 0,
        gold: 0,
        rice: 0,
        crew: 0,
        crewTypeId: 0,
        train: 0,
        atmos: 0,
        age: 0,
        npcState: 0,
        triggerState: {
            flags: {},
            counters: {},
            modifiers: {},
            meta: {},
        },
        meta: {},
    };
    const logicNation: LogicNation = {
        id: nation.id,
        name: nation.name,
        color: nation.color,
        capitalCityId: nation.capitalCityId,
        chiefGeneralId: null,
        gold: nation.gold ?? 0,
        rice: nation.rice ?? 0,
        power: 0,
        level: nation.level,
        typeCode: nation.typeCode,
        meta: nationMeta,
    };
    return { general, nation: logicNation };
};

const buildNationIncomeContext = async (nation: NationIncomeRow): Promise<NationIncomeContext> => {
    let trait: NationTraitModule = null;
    if (isNationTraitKey(nation.typeCode)) {
        [trait] = await loadNationTraitModules([nation.typeCode], new NationTraitLoader());
    }
    return {
        trait,
        context: buildIncomeContext(nation),
        rate: resolveNationRate(nation),
    };
};

const applyNationIncome = (
    incomeContext: NationIncomeContext,
    type: 'gold' | 'rice' | 'pop',
    amount: number
): number => {
    if (!incomeContext.trait?.onCalcNationalIncome) {
        return amount;
    }
    return incomeContext.trait.onCalcNationalIncome(incomeContext.context, type, amount);
};

const calcCityGoldIncome = (
    incomeContext: NationIncomeContext,
    city: CityIncomeRow,
    officerCnt: number,
    isCapital: boolean,
    nationLevel: number
): number => {
    if (city.supplyState === 0) {
        return 0;
    }
    const trustRatio = city.trust / 200 + 0.5;
    const commMax = Math.max(1, city.commerceMax);
    const secuMax = Math.max(1, city.securityMax);

    let income = (city.population * city.commerce * trustRatio) / commMax / 30;
    income *= 1 + city.security / secuMax / 10;
    income *= Math.pow(1.05, officerCnt);
    if (isCapital && nationLevel > 0) {
        income *= 1 + 1 / (3 * nationLevel);
    }

    const adjusted = applyNationIncome(incomeContext, 'gold', income);
    return Math.round(adjusted * (incomeContext.rate / 20));
};

const calcCityRiceIncome = (
    incomeContext: NationIncomeContext,
    city: CityIncomeRow,
    officerCnt: number,
    isCapital: boolean,
    nationLevel: number
): number => {
    if (city.supplyState === 0) {
        return 0;
    }
    const trustRatio = city.trust / 200 + 0.5;
    const agriMax = Math.max(1, city.agricultureMax);
    const secuMax = Math.max(1, city.securityMax);

    let income = (city.population * city.agriculture * trustRatio) / agriMax / 30;
    income *= 1 + city.security / secuMax / 10;
    income *= Math.pow(1.05, officerCnt);
    if (isCapital && nationLevel > 0) {
        income *= 1 + 1 / (3 * nationLevel);
    }

    const adjusted = applyNationIncome(incomeContext, 'rice', income);
    return Math.round(adjusted * (incomeContext.rate / 20));
};

const calcCityWallIncome = (
    incomeContext: NationIncomeContext,
    city: CityIncomeRow,
    officerCnt: number,
    isCapital: boolean,
    nationLevel: number
): number => {
    if (city.supplyState === 0) {
        return 0;
    }
    const wallMax = Math.max(1, city.wallMax);
    const secuMax = Math.max(1, city.securityMax);

    let income = (city.defence * city.wall) / wallMax / 3;
    income *= 1 + city.security / secuMax / 10;
    income *= Math.pow(1.05, officerCnt);
    if (isCapital && nationLevel > 0) {
        income *= 1 + 1 / (3 * nationLevel);
    }

    const adjusted = applyNationIncome(incomeContext, 'rice', income);
    return Math.round(adjusted * (incomeContext.rate / 20));
};

const assertNationAccess = (general: { nationId: number; officerLevel: number }) => {
    if (general.nationId <= 0 || general.officerLevel <= 0) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Nation membership required.' });
    }
};

const mapGeneralList = async (
    generals: GeneralListRow[],
    cityNameMap: Map<number, string>,
    troopNameMap: Map<number, string>
) => {
    const personalityKeys = generals.map((general) => normalizeTraitKey(general.personalCode));
    const domesticKeys = generals.map((general) => normalizeTraitKey(general.specialCode));
    const warKeys = generals.map((general) => normalizeTraitKey(general.special2Code));

    const [personalityMap, domesticMap, warMap] = await Promise.all([
        loadTraitNames(personalityKeys, 'personality'),
        loadTraitNames(domesticKeys, 'domestic'),
        loadTraitNames(warKeys, 'war'),
    ]);

    return generals.map((general) => {
        const meta = asRecord(general.meta);
        const officerCity = resolveOfficerCity(meta);
        const permission = resolvePermission(meta);
        const belong = resolveBelong(meta);
        const personalityKey = normalizeTraitKey(general.personalCode);
        const domesticKey = normalizeTraitKey(general.specialCode);
        const warKey = normalizeTraitKey(general.special2Code);

        return {
            id: general.id,
            name: general.name,
            npcState: general.npcState,
            officerLevel: general.officerLevel,
            cityId: general.cityId,
            cityName: cityNameMap.get(general.cityId) ?? null,
            troopId: general.troopId,
            troopName: troopNameMap.get(general.troopId) ?? null,
            officerCity,
            officerCityName: officerCity > 0 ? cityNameMap.get(officerCity) ?? null : null,
            stats: {
                leadership: general.leadership,
                strength: general.strength,
                intelligence: general.intel,
            },
            experience: general.experience,
            dedication: general.dedication,
            injury: general.injury,
            gold: general.gold,
            rice: general.rice,
            crew: general.crew,
            personality: personalityKey
                ? {
                      key: personalityKey,
                      name: personalityMap.get(personalityKey)?.name ?? personalityKey,
                  }
                : null,
            specialDomestic: domesticKey
                ? {
                      key: domesticKey,
                      name: domesticMap.get(domesticKey)?.name ?? domesticKey,
                  }
                : null,
            specialWar: warKey
                ? {
                      key: warKey,
                      name: warMap.get(warKey)?.name ?? warKey,
                  }
                : null,
            belong,
            permission,
        };
    });
};

export const nationRouter = router({
    getGeneralList: authedProcedure.query(async ({ ctx }) => {
        const general = await getMyGeneral(ctx);
        assertNationAccess(general);

        const [nation, cityRows, troopRows, generalRows, worldState] = await Promise.all([
            ctx.db.nation.findUnique({
                where: { id: general.nationId },
                select: {
                    id: true,
                    name: true,
                    color: true,
                    level: true,
                    typeCode: true,
                    capitalCityId: true,
                    meta: true,
                },
            }),
            ctx.db.city.findMany({ select: { id: true, name: true } }),
            ctx.db.troop.findMany({ select: { troopLeaderId: true, name: true } }),
            ctx.db.general.findMany({
                where: { nationId: general.nationId },
                select: {
                    id: true,
                    name: true,
                    npcState: true,
                    nationId: true,
                    cityId: true,
                    troopId: true,
                    picture: true,
                    imageServer: true,
                    officerLevel: true,
                    leadership: true,
                    strength: true,
                    intel: true,
                    experience: true,
                    dedication: true,
                    injury: true,
                    gold: true,
                    rice: true,
                    crew: true,
                    personalCode: true,
                    specialCode: true,
                    special2Code: true,
                    meta: true,
                    penalty: true,
                },
                orderBy: { id: 'asc' },
            }),
            ctx.db.worldState.findFirst(),
        ]);

        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
        }

        const cityNameMap = new Map(cityRows.map((city) => [city.id, city.name]));
        const troopNameMap = new Map(troopRows.map((troop) => [troop.troopLeaderId, troop.name]));
        const list = await mapGeneralList(generalRows, cityNameMap, troopNameMap);

        return {
            nation: {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                level: nation.level,
                typeCode: nation.typeCode,
                capitalCityId: nation.capitalCityId ?? 0,
            },
            chiefStatMin: resolveChiefStatMin(worldState),
            generals: list,
        };
    }),
    getCityOverview: authedProcedure.query(async ({ ctx }) => {
        const me = await getMyGeneral(ctx);
        assertNationAccess(me);

        const [nation, cityRows, generalRows, worldState] = await Promise.all([
            ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: {
                    id: true,
                    name: true,
                    color: true,
                    level: true,
                    typeCode: true,
                    capitalCityId: true,
                    meta: true,
                },
            }),
            ctx.db.city.findMany({
                where: { nationId: me.nationId },
                select: {
                    id: true,
                    name: true,
                    level: true,
                    nationId: true,
                    region: true,
                    population: true,
                    populationMax: true,
                    agriculture: true,
                    agricultureMax: true,
                    commerce: true,
                    commerceMax: true,
                    security: true,
                    securityMax: true,
                    trust: true,
                    trade: true,
                    defence: true,
                    defenceMax: true,
                    wall: true,
                    wallMax: true,
                    supplyState: true,
                    frontState: true,
                    meta: true,
                },
                orderBy: { id: 'asc' },
            }),
            ctx.db.general.findMany({
                where: { nationId: me.nationId },
                select: {
                    id: true,
                    name: true,
                    npcState: true,
                    officerLevel: true,
                    cityId: true,
                    leadership: true,
                    strength: true,
                    intel: true,
                    meta: true,
                },
                orderBy: { id: 'asc' },
            }),
            ctx.db.worldState.findFirst(),
        ]);

        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
        }

        const cityNameMap = new Map(cityRows.map((city) => [city.id, city.name]));

        const officerByCity = new Map<number, Record<number, GeneralOfficerRow>>();
        const officerCntByCity = new Map<number, number>();

        for (const general of generalRows) {
            if (general.officerLevel < 2 || general.officerLevel > 4) {
                continue;
            }
            const meta = asRecord(general.meta);
            const officerCity = resolveOfficerCity(meta);
            if (!officerCity) {
                continue;
            }
            const entry = officerByCity.get(officerCity) ?? {};
            entry[general.officerLevel] = general;
            officerByCity.set(officerCity, entry);

            if (general.cityId === officerCity) {
                officerCntByCity.set(officerCity, (officerCntByCity.get(officerCity) ?? 0) + 1);
            }
        }

        const incomeContext = await buildNationIncomeContext(nation);

        const cities = cityRows.map((city) => {
            const officers = officerByCity.get(city.id) ?? {};
            const officerCnt = officerCntByCity.get(city.id) ?? 0;
            const isCapital = nation.capitalCityId === city.id;
            const incomes = {
                gold: calcCityGoldIncome(incomeContext, city, officerCnt, isCapital, nation.level),
                rice: calcCityRiceIncome(incomeContext, city, officerCnt, isCapital, nation.level),
                wall: calcCityWallIncome(incomeContext, city, officerCnt, isCapital, nation.level),
            };

            return {
                id: city.id,
                name: city.name,
                level: city.level,
                region: city.region,
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
                supplyState: city.supplyState,
                frontState: city.frontState,
                incomes,
                officers: {
                    4: officers[4]
                        ? {
                              id: officers[4].id,
                              name: officers[4].name,
                              npcState: officers[4].npcState,
                              officerLevel: officers[4].officerLevel,
                              cityId: officers[4].cityId,
                              cityName: cityNameMap.get(officers[4].cityId) ?? null,
                          }
                        : null,
                    3: officers[3]
                        ? {
                              id: officers[3].id,
                              name: officers[3].name,
                              npcState: officers[3].npcState,
                              officerLevel: officers[3].officerLevel,
                              cityId: officers[3].cityId,
                              cityName: cityNameMap.get(officers[3].cityId) ?? null,
                          }
                        : null,
                    2: officers[2]
                        ? {
                              id: officers[2].id,
                              name: officers[2].name,
                              npcState: officers[2].npcState,
                              officerLevel: officers[2].officerLevel,
                              cityId: officers[2].cityId,
                              cityName: cityNameMap.get(officers[2].cityId) ?? null,
                          }
                        : null,
                },
            };
        });

        const generals = generalRows.map((general) => {
            const meta = asRecord(general.meta);
            return {
                id: general.id,
                name: general.name,
                npcState: general.npcState,
                officerLevel: general.officerLevel,
                cityId: general.cityId,
                officerCity: resolveOfficerCity(meta),
                stats: {
                    leadership: general.leadership,
                    strength: general.strength,
                    intelligence: general.intel,
                },
            };
        });

        return {
            me: {
                id: me.id,
                officerLevel: me.officerLevel,
            },
            nation: {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                level: nation.level,
                typeCode: nation.typeCode,
                capitalCityId: nation.capitalCityId ?? 0,
                rate: resolveNationRate(nation),
            },
            chiefStatMin: resolveChiefStatMin(worldState),
            cities,
            generals,
        };
    }),
    getPersonnelInfo: authedProcedure.query(async ({ ctx }) => {
        const me = await getMyGeneral(ctx);
        assertNationAccess(me);

        const [nation, cityRows, troopRows, generalRows, worldState] = await Promise.all([
            ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: {
                    id: true,
                    name: true,
                    color: true,
                    level: true,
                    typeCode: true,
                    capitalCityId: true,
                    meta: true,
                },
            }),
            ctx.db.city.findMany({
                where: { nationId: me.nationId },
                select: { id: true, name: true, level: true, region: true },
                orderBy: { id: 'asc' },
            }),
            ctx.db.troop.findMany({ select: { troopLeaderId: true, name: true } }),
            ctx.db.general.findMany({
                where: { nationId: me.nationId },
                select: {
                    id: true,
                    name: true,
                    npcState: true,
                    nationId: true,
                    cityId: true,
                    troopId: true,
                    officerLevel: true,
                    leadership: true,
                    strength: true,
                    intel: true,
                    experience: true,
                    dedication: true,
                    injury: true,
                    gold: true,
                    rice: true,
                    crew: true,
                    personalCode: true,
                    specialCode: true,
                    special2Code: true,
                    meta: true,
                    penalty: true,
                },
                orderBy: { id: 'asc' },
            }),
            ctx.db.worldState.findFirst(),
        ]);

        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
        }

        const cityNameMap = new Map(cityRows.map((city) => [city.id, city.name]));
        const troopNameMap = new Map(troopRows.map((troop) => [troop.troopLeaderId, troop.name]));
        const mappedGenerals = await mapGeneralList(generalRows, cityNameMap, troopNameMap);

        const chiefAssignments = mappedGenerals
            .filter((general) => general.officerLevel >= 5)
            .reduce<Record<number, typeof mappedGenerals[number]>>((acc, general) => {
                acc[general.officerLevel] = general;
                return acc;
            }, {});

        const cityAssignments = cityRows.map((city) => {
            const officers = mappedGenerals.filter(
                (general) => general.officerLevel >= 2 && general.officerLevel <= 4 && general.officerCity === city.id
            );

            const officerMap: Record<number, typeof mappedGenerals[number] | null> = {
                4: null,
                3: null,
                2: null,
            };

            for (const officer of officers) {
                officerMap[officer.officerLevel] = officer;
            }

            return {
                id: city.id,
                name: city.name,
                level: city.level,
                region: city.region,
                officers: officerMap,
            };
        });

        const penaltyMap = new Map<number, Record<string, unknown>>(
            generalRows.map((row) => [row.id, asRecord(row.penalty)])
        );

        const permissionCandidates = mappedGenerals
            .filter((general) => general.officerLevel !== 12)
            .map((general) => {
                const penalty = penaltyMap.get(general.id) ?? {};
                const maxPermission = checkSecretMaxPermission(penalty);
                return {
                    id: general.id,
                    name: general.name,
                    npcState: general.npcState,
                    permission: general.permission,
                    maxPermission,
                };
            });

        const ambassadors = permissionCandidates.filter(
            (candidate) => candidate.permission === 'ambassador' || candidate.maxPermission === 4
        );
        const auditors = permissionCandidates.filter(
            (candidate) => candidate.permission === 'auditor' || candidate.maxPermission >= 3
        );

        return {
            me: {
                id: me.id,
                officerLevel: me.officerLevel,
            },
            nation: {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                level: nation.level,
                typeCode: nation.typeCode,
                capitalCityId: nation.capitalCityId ?? 0,
            },
            chiefStatMin: resolveChiefStatMin(worldState),
            generals: mappedGenerals,
            chiefAssignments,
            cityAssignments,
            permissionCandidates: {
                ambassadors,
                auditors,
            },
        };
    }),
    getChiefCenter: authedProcedure.query(async ({ ctx }) => {
        const me = await getMyGeneral(ctx);
        assertNationAccess(me);

        const [nation, worldState, nationGenerals] = await Promise.all([
            ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: {
                    id: true,
                    name: true,
                    level: true,
                    meta: true,
                },
            }),
            ctx.db.worldState.findFirst(),
            ctx.db.general.findMany({
                where: { nationId: me.nationId, officerLevel: { gte: 5 } },
                select: {
                    id: true,
                    name: true,
                    officerLevel: true,
                    npcState: true,
                    turnTime: true,
                },
            }),
        ]);

        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
        }
        if (!worldState) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'World state is not initialized.' });
        }

        const permissionLevel = resolveSecretPermission(
            {
                nationId: me.nationId,
                officerLevel: me.officerLevel,
                meta: me.meta,
                penalty: me.penalty,
            },
            nation.meta
        );
        if (permissionLevel < 1) {
            throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
        }

        const chiefLevels = [12, 10, 8, 6, 11, 9, 7, 5];
        const generalByLevel = new Map(nationGenerals.map((general) => [general.officerLevel, general]));

        const turnsByLevel = await Promise.all(
            chiefLevels.map((level) => listNationTurns(ctx.db, nation.id, level))
        );

        const chiefs = chiefLevels.map((level, idx) => {
            const entry = generalByLevel.get(level);
            return {
                officerLevel: level,
                name: entry?.name ?? null,
                npcState: entry?.npcState ?? null,
                turnTime: entry?.turnTime ? entry.turnTime.toISOString() : null,
                turns: turnsByLevel[idx],
            };
        });

        return {
            me: {
                id: me.id,
                officerLevel: me.officerLevel,
                nationId: me.nationId,
            },
            nation: {
                id: nation.id,
                name: nation.name,
                level: nation.level,
            },
            currentYear: worldState.currentYear,
            currentMonth: worldState.currentMonth,
            turnTermMinutes: Math.max(1, Math.round(worldState.tickSeconds / 60)),
            maxTurns: MAX_NATION_TURNS,
            chiefs,
        };
    }),
    changePermission: authedProcedure
        .input(
            z.object({
                isAmbassador: z.boolean(),
                targetGeneralIds: z.array(z.number().int().positive()),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const general = await getMyGeneral(ctx);
            const result = await ctx.turnDaemon.requestCommand({
                type: 'changePermission',
                generalId: general.id,
                isAmbassador: input.isAmbassador,
                targetGeneralIds: input.targetGeneralIds,
            });
            if (!result || result.type !== 'changePermission') {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
            }
            if (!result.ok) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
            }
            return { ok: true };
        }),
    kick: authedProcedure
        .input(z.object({ destGeneralId: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
            const general = await getMyGeneral(ctx);
            const result = await ctx.turnDaemon.requestCommand({
                type: 'kick',
                generalId: general.id,
                destGeneralId: input.destGeneralId,
            });
            if (!result || result.type !== 'kick') {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
            }
            if (!result.ok) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
            }
            return { ok: true };
        }),
    appoint: authedProcedure
        .input(
            z.object({
                destGeneralId: z.number().int().nonnegative(),
                destCityId: z.number().int().nonnegative(),
                officerLevel: z.number().int().nonnegative(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const general = await getMyGeneral(ctx);
            const result = await ctx.turnDaemon.requestCommand({
                type: 'appoint',
                generalId: general.id,
                destGeneralId: input.destGeneralId,
                destCityId: input.destCityId,
                officerLevel: input.officerLevel,
            });
            if (!result || result.type !== 'appoint') {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
            }
            if (!result.ok) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
            }
            return { ok: true };
        }),
});
