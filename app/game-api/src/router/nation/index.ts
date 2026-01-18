import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asNumber, asRecord } from '@sammo-ts/common';
import { LogCategory, LogScope } from '@sammo-ts/infra';
import {
    calcCityGoldIncome,
    calcCityRiceIncome,
    calcCityWallIncome,
    createIncomeActionContext,
    DomesticTraitLoader,
    getGoldIncome,
    getOutcome,
    getRiceIncome,
    getWallIncome,
    getWarGoldIncome,
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
    type CityIncomeSource,
    type Nation as LogicNation,
    type NationIncomeContext,
    type TriggerNationalIncomeType,
    type TriggerValue,
} from '@sammo-ts/logic';

import type { GameApiContext, InputJsonValue, WorldStateRow } from '../../context.js';
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

type NationCountRow = {
    nationId: number;
    count: number;
};

type NationStratRow = {
    id: number;
    name: string;
    color: string;
    level: number;
    typeCode: string;
    capitalCityId: number | null;
    gold: number | null;
    rice: number | null;
    tech: number | null;
    meta: unknown;
};

type DiplomacyRow = {
    destNationId: number;
    stateCode: number;
    term: number;
};

type GeneralPowerRow = {
    id: number;
    nationId: number;
    cityId: number;
    npcState: number;
    officerLevel: number;
    leadership: number;
    strength: number;
    intel: number;
    experience: number;
    dedication: number;
    gold: number;
    rice: number;
    meta: unknown;
};

const traitCache: TraitCache = {
    domestic: new Map(),
    war: new Map(),
    personality: new Map(),
    nation: new Map(),
};

const DEFAULT_CHIEF_STAT_MIN = 65;
const MAX_AVAILABLE_WAR_SETTING_CNT = 10;
const INC_AVAILABLE_WAR_SETTING_CNT = 2;

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

const readMetaBool = (meta: Record<string, unknown>, key: string, fallback = false): boolean => {
    const raw = meta[key];
    if (typeof raw === 'boolean') {
        return raw;
    }
    if (typeof raw === 'number') {
        return raw !== 0;
    }
    if (typeof raw === 'string') {
        const lowered = raw.toLowerCase();
        if (lowered === 'true' || lowered === '1') {
            return true;
        }
        if (lowered === 'false' || lowered === '0') {
            return false;
        }
    }
    return fallback;
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

const toIncomeCity = (city: CityIncomeRow): CityIncomeSource => ({
    id: city.id,
    population: city.population,
    populationMax: city.populationMax,
    agriculture: city.agriculture,
    agricultureMax: city.agricultureMax,
    commerce: city.commerce,
    commerceMax: city.commerceMax,
    security: city.security,
    securityMax: city.securityMax,
    trust: city.trust,
    supplyState: city.supplyState,
    defence: city.defence,
    defenceMax: city.defenceMax,
    wall: city.wall,
    wallMax: city.wallMax,
    meta: asRecord(city.meta),
});

const resolveNationBill = (meta: Record<string, unknown>): number => readMetaNumber(meta, 'bill', 100);

const resolveNationSecretLimit = (meta: Record<string, unknown>): number => {
    const legacy = readMetaNumber(meta, 'secretlimit', -1);
    if (legacy >= 0) {
        return legacy;
    }
    return readMetaNumber(meta, 'secretLimit', 3);
};

const resolveNationBlockWar = (meta: Record<string, unknown>): boolean =>
    readMetaBool(meta, 'war', readMetaBool(meta, 'blockWar', false));

const resolveNationBlockScout = (meta: Record<string, unknown>): boolean =>
    readMetaBool(meta, 'scout', readMetaBool(meta, 'blockScout', false));

const resolveNationNotice = (meta: Record<string, unknown>): string =>
    typeof meta.notice === 'string' ? meta.notice : '';

const resolveNationScoutMessage = (meta: Record<string, unknown>): string =>
    typeof meta.infoText === 'string' ? meta.infoText : '';

const resolveWarSettingRemain = (meta: Record<string, unknown>): number => {
    const legacy = readMetaNumber(meta, 'available_war_setting_cnt', -1);
    const fallback = legacy >= 0 ? legacy : readMetaNumber(meta, 'availableWarSettingCnt', MAX_AVAILABLE_WAR_SETTING_CNT);
    return Math.max(0, Math.min(MAX_AVAILABLE_WAR_SETTING_CNT, fallback));
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

const buildNationIncomeContext = async (nation: NationIncomeRow): Promise<NationIncomeContext> => {
    let trait: NationTraitModule = null;
    if (isNationTraitKey(nation.typeCode)) {
        [trait] = await loadNationTraitModules([nation.typeCode], new NationTraitLoader());
    }
    const nationMeta = asRecord(nation.meta) as Record<string, TriggerValue>;
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
    const actionContext = createIncomeActionContext(logicNation);
    const modifyIncome = trait?.onCalcNationalIncome
        ? (type: TriggerNationalIncomeType, amount: number) => trait.onCalcNationalIncome!(actionContext, type, amount)
        : undefined;
    return {
        modifyIncome,
        rate: resolveNationRate(nation),
    };
};

const formatDateTime = (value: Date | null): string => {
    if (!value) {
        return '';
    }
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    const hours = String(value.getHours()).padStart(2, '0');
    const minutes = String(value.getMinutes()).padStart(2, '0');
    const seconds = String(value.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const zGeneralLogType = z.enum(['generalHistory', 'generalAction', 'battleResult', 'battleDetail']);
type GeneralLogType = z.infer<typeof zGeneralLogType>;

const assertNationAccess = (general: { nationId: number; officerLevel: number }) => {
    if (general.nationId <= 0 || general.officerLevel <= 0) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Nation membership required.' });
    }
};

const resolveNationPermission = (
    general: { nationId: number; officerLevel: number; meta: unknown; penalty: unknown },
    nationMeta: unknown,
    checkSecretLimit = true
): number =>
    resolveSecretPermission(
        {
            nationId: general.nationId,
            officerLevel: general.officerLevel,
            meta: general.meta,
            penalty: general.penalty,
        },
        nationMeta,
        checkSecretLimit
    );

const assertNationEditable = (
    general: { nationId: number; officerLevel: number; meta: unknown; penalty: unknown },
    nationMeta: unknown
): void => {
    const permission = resolveNationPermission(general, nationMeta, false);
    if (permission < 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
    }
    if (general.officerLevel < 5 && permission !== 4) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
    }
};

const updateNationMeta = async (
    ctx: Pick<GameApiContext, 'db'>,
    nationId: number,
    updates: Record<string, unknown>
): Promise<InputJsonValue> => {
    const nation = await ctx.db.nation.findUnique({
        where: { id: nationId },
        select: { meta: true },
    });
    if (!nation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
    }
    const meta = asRecord(nation.meta);
    const nextMeta = { ...meta, ...updates } as InputJsonValue;
    await ctx.db.nation.update({
        where: { id: nationId },
        data: {
            meta: nextMeta,
        },
    });
    return nextMeta;
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
            const incomeCity = toIncomeCity(city);
            const incomes = {
                gold: calcCityGoldIncome(incomeContext, incomeCity, officerCnt, isCapital, nation.level),
                rice: calcCityRiceIncome(incomeContext, incomeCity, officerCnt, isCapital, nation.level),
                wall: calcCityWallIncome(incomeContext, incomeCity, officerCnt, isCapital, nation.level),
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
    getStratFinan: authedProcedure.query(async ({ ctx }) => {
        const me = await getMyGeneral(ctx);
        assertNationAccess(me);

        const [nation, worldState, nationRows, diplomacyRows, generalCounts, cityCounts, cityRows, generalRows] =
            (await Promise.all([
                ctx.db.nation.findUnique({
                    where: { id: me.nationId },
                    select: {
                        id: true,
                        name: true,
                        color: true,
                        level: true,
                        typeCode: true,
                        capitalCityId: true,
                        gold: true,
                        rice: true,
                        tech: true,
                        meta: true,
                    },
                }),
                ctx.db.worldState.findFirst(),
                ctx.db.nation.findMany({
                    select: {
                        id: true,
                        name: true,
                        color: true,
                        level: true,
                        typeCode: true,
                        capitalCityId: true,
                        gold: true,
                        rice: true,
                        tech: true,
                        meta: true,
                    },
                    orderBy: { id: 'asc' },
                }),
                ctx.db.diplomacy.findMany({
                    where: { srcNationId: me.nationId },
                    select: {
                        destNationId: true,
                        stateCode: true,
                        term: true,
                    },
                }),
                ctx.db.$queryRaw<NationCountRow[]>`
                    SELECT nation_id as "nationId", COUNT(*)::int as "count"
                    FROM general
                    GROUP BY nation_id
                `,
                ctx.db.$queryRaw<NationCountRow[]>`
                    SELECT nation_id as "nationId", COUNT(*)::int as "count"
                    FROM city
                    GROUP BY nation_id
                `,
                ctx.db.city.findMany({
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
                }),
                ctx.db.general.findMany({
                    select: {
                        id: true,
                        nationId: true,
                        cityId: true,
                        npcState: true,
                        officerLevel: true,
                        leadership: true,
                        strength: true,
                        intel: true,
                        experience: true,
                        dedication: true,
                        gold: true,
                        rice: true,
                        meta: true,
                    },
                }),
            ])) as [
                (NationIncomeRow & { tech: number | null }) | null,
                WorldStateRow | null,
                NationStratRow[],
                DiplomacyRow[],
                NationCountRow[],
                NationCountRow[],
                CityIncomeRow[],
                GeneralPowerRow[],
            ];

        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
        }
        if (!worldState) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'World state is not initialized.' });
        }

        const permissionLevel = resolveNationPermission(me, nation.meta, true);
        if (permissionLevel < 1) {
            throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
        }

        const nationMeta = asRecord(nation.meta);
        const editable = me.officerLevel >= 5 || permissionLevel === 4;

        const generalCountMap = new Map<number, number>();
        for (const row of generalCounts) {
            generalCountMap.set(row.nationId, row.count);
        }

        const cityCountMap = new Map<number, number>();
        for (const row of cityCounts) {
            cityCountMap.set(row.nationId, row.count);
        }

        const diplomacyMap = new Map<number, { state: number; term: number | null }>();
        for (const row of diplomacyRows) {
            diplomacyMap.set(row.destNationId, { state: row.stateCode, term: row.term });
        }

        const cityStatsByNation = new Map<number, { popSum: number; valueSum: number; maxSum: number }>();
        for (const city of cityRows) {
            const entry = cityStatsByNation.get(city.nationId) ?? { popSum: 0, valueSum: 0, maxSum: 0 };
            const valueSum =
                city.population +
                city.agriculture +
                city.commerce +
                city.security +
                city.wall +
                city.defence;
            const maxSum =
                city.populationMax +
                city.agricultureMax +
                city.commerceMax +
                city.securityMax +
                city.wallMax +
                city.defenceMax;
            entry.popSum += city.population;
            entry.valueSum += valueSum;
            entry.maxSum += maxSum;
            cityStatsByNation.set(city.nationId, entry);
        }

        const generalStatsByNation = new Map<number, { goldRice: number; statPower: number; expDed: number }>();
        for (const general of generalRows) {
            const entry = generalStatsByNation.get(general.nationId) ?? { goldRice: 0, statPower: 0, expDed: 0 };
            entry.goldRice += general.gold + general.rice;
            const leadership = general.leadership;
            const strength = general.strength;
            const intel = general.intel;
            const npcMultiplier = general.npcState < 2 ? 1.2 : 1;
            const leaderCore = leadership >= 40 ? leadership : 0;
            entry.statPower += npcMultiplier * leaderCore * 2 + (Math.sqrt(intel * strength) * 2 + leadership / 2) / 2;
            entry.expDed += general.experience + general.dedication;
            generalStatsByNation.set(general.nationId, entry);
        }

        const powerByNation = new Map<number, number>();
        for (const nationItem of nationRows) {
            const generalStats = generalStatsByNation.get(nationItem.id) ?? { goldRice: 0, statPower: 0, expDed: 0 };
            const cityStats = cityStatsByNation.get(nationItem.id) ?? { popSum: 0, valueSum: 0, maxSum: 0 };
            const resource = Math.round(((nationItem.gold ?? 0) + (nationItem.rice ?? 0) + generalStats.goldRice) / 100);
            const tech = nationItem.tech ?? 0;
            const cityPower =
                nationItem.level > 0 && cityStats.maxSum > 0
                    ? Math.round((cityStats.popSum * cityStats.valueSum) / cityStats.maxSum / 100)
                    : 0;
            const expDed = Math.round(generalStats.expDed / 100);
            powerByNation.set(
                nationItem.id,
                Math.round((resource + tech + cityPower + generalStats.statPower + expDed) / 10)
            );
        }

        const nationsList = nationRows.map((nationItem) => {
            const diplomacy =
                nationItem.id === nation.id
                    ? { state: 7, term: null }
                    : diplomacyMap.get(nationItem.id) ?? { state: 2, term: 0 };
            return {
                id: nationItem.id,
                name: nationItem.name,
                color: nationItem.color,
                level: nationItem.level,
                power: powerByNation.get(nationItem.id) ?? 0,
                generalCount: generalCountMap.get(nationItem.id) ?? 0,
                cityCount: cityCountMap.get(nationItem.id) ?? 0,
                diplomacy,
            };
        });

        const nationCities = cityRows.filter((city) => city.nationId === nation.id);
        const nationGenerals = generalRows.filter((general) => general.nationId === nation.id);

        const officerCntByCity = new Map<number, number>();
        for (const general of nationGenerals) {
            if (general.officerLevel < 2 || general.officerLevel > 4) {
                continue;
            }
            const officerCity = resolveOfficerCity(asRecord(general.meta));
            if (!officerCity || general.cityId !== officerCity) {
                continue;
            }
            officerCntByCity.set(officerCity, (officerCntByCity.get(officerCity) ?? 0) + 1);
        }

        const incomeContext = await buildNationIncomeContext(nation);
        const baseIncomeContext: NationIncomeContext = { ...incomeContext, rate: 100 };
        const incomeCities = nationCities.map(toIncomeCity);
        const goldCityIncome = getGoldIncome(
            baseIncomeContext,
            incomeCities,
            officerCntByCity,
            nation.capitalCityId ?? 0,
            nation.level
        );
        const riceCityIncome = getRiceIncome(
            baseIncomeContext,
            incomeCities,
            officerCntByCity,
            nation.capitalCityId ?? 0,
            nation.level
        );
        const riceWallIncome = getWallIncome(
            baseIncomeContext,
            incomeCities,
            officerCntByCity,
            nation.capitalCityId ?? 0,
            nation.level
        );
        const warGoldIncome = getWarGoldIncome(baseIncomeContext, incomeCities);

        const outcome = getOutcome(
            100,
            nationGenerals.filter((general) => general.npcState !== 5)
        );

        return {
            editable,
            nationMsg: resolveNationNotice(nationMeta),
            scoutMsg: resolveNationScoutMessage(nationMeta),
            nationId: nation.id,
            officerLevel: me.officerLevel,
            year: worldState.currentYear,
            month: worldState.currentMonth,
            nationsList,
            gold: nation.gold ?? 0,
            rice: nation.rice ?? 0,
            income: {
                gold: {
                    city: goldCityIncome,
                    war: warGoldIncome,
                },
                rice: {
                    city: riceCityIncome,
                    wall: riceWallIncome,
                },
            },
            outcome,
            policy: {
                rate: resolveNationRate(nation),
                bill: resolveNationBill(nationMeta),
                secretLimit: resolveNationSecretLimit(nationMeta),
                blockScout: resolveNationBlockScout(nationMeta),
                blockWar: resolveNationBlockWar(nationMeta),
            },
            warSettingCnt: {
                remain: resolveWarSettingRemain(nationMeta),
                inc: INC_AVAILABLE_WAR_SETTING_CNT,
                max: MAX_AVAILABLE_WAR_SETTING_CNT,
            },
        };
    }),
    setNotice: authedProcedure
        .input(
            z.object({
                msg: z.string().max(16384),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertNationAccess(me);
            const nation = await ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: { meta: true },
            });
            if (!nation) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
            }
            assertNationEditable(me, nation.meta);
            await updateNationMeta(ctx, me.nationId, {
                notice: input.msg,
            });
            return { ok: true };
        }),
    setScoutMsg: authedProcedure
        .input(
            z.object({
                msg: z.string().max(1000),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertNationAccess(me);
            const nation = await ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: { meta: true },
            });
            if (!nation) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
            }
            assertNationEditable(me, nation.meta);
            await updateNationMeta(ctx, me.nationId, {
                infoText: input.msg,
            });
            return { ok: true };
        }),
    setRate: authedProcedure
        .input(
            z.object({
                amount: z.number().int().min(5).max(30),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertNationAccess(me);
            const nation = await ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: { meta: true },
            });
            if (!nation) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
            }
            assertNationEditable(me, nation.meta);
            await updateNationMeta(ctx, me.nationId, {
                rate: input.amount,
            });
            return { ok: true };
        }),
    setBill: authedProcedure
        .input(
            z.object({
                amount: z.number().int().min(20).max(200),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertNationAccess(me);
            const nation = await ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: { meta: true },
            });
            if (!nation) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
            }
            assertNationEditable(me, nation.meta);
            await updateNationMeta(ctx, me.nationId, {
                bill: input.amount,
            });
            return { ok: true };
        }),
    setSecretLimit: authedProcedure
        .input(
            z.object({
                amount: z.number().int().min(1).max(99),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertNationAccess(me);
            const nation = await ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: { meta: true },
            });
            if (!nation) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
            }
            assertNationEditable(me, nation.meta);
            await updateNationMeta(ctx, me.nationId, {
                secretlimit: input.amount,
            });
            return { ok: true };
        }),
    setBlockWar: authedProcedure
        .input(
            z.object({
                value: z.boolean(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertNationAccess(me);
            const nation = await ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: { meta: true },
            });
            if (!nation) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
            }
            assertNationEditable(me, nation.meta);

            const meta = asRecord(nation.meta);
            const remain = resolveWarSettingRemain(meta);
            if (remain <= 0) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '잔여 횟수가 부족합니다.' });
            }
            const nextRemain = Math.max(0, remain - 1);
            await updateNationMeta(ctx, me.nationId, {
                war: input.value ? 1 : 0,
                available_war_setting_cnt: nextRemain,
            });
            return { availableCnt: nextRemain };
        }),
    setBlockScout: authedProcedure
        .input(
            z.object({
                value: z.boolean(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertNationAccess(me);
            const nation = await ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: { meta: true },
            });
            if (!nation) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
            }
            assertNationEditable(me, nation.meta);
            await updateNationMeta(ctx, me.nationId, {
                scout: input.value ? 1 : 0,
            });
            return { ok: true };
        }),
    getBattleCenter: authedProcedure.query(async ({ ctx }) => {
        const me = await getMyGeneral(ctx);
        assertNationAccess(me);

        const [nation, worldState, generalRows] = await Promise.all([
            ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: {
                    id: true,
                    name: true,
                    color: true,
                    level: true,
                    meta: true,
                },
            }),
            ctx.db.worldState.findFirst(),
            ctx.db.general.findMany({
                where: { nationId: me.nationId },
                select: {
                    id: true,
                    name: true,
                    npcState: true,
                    officerLevel: true,
                    cityId: true,
                    turnTime: true,
                    recentWarTime: true,
                    leadership: true,
                    strength: true,
                    intel: true,
                    experience: true,
                    dedication: true,
                    injury: true,
                    gold: true,
                    rice: true,
                    crew: true,
                    train: true,
                    atmos: true,
                },
                orderBy: { id: 'asc' },
            }),
        ]);

        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
        }
        if (!worldState) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'World state is not initialized.' });
        }

        const permissionLevel = resolveNationPermission(me, nation.meta, true);
        if (permissionLevel < 1) {
            throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
        }

        const generalIds = generalRows.map((general) => general.id);
        const battleCounts =
            generalIds.length > 0
                ? await ctx.db.logEntry.groupBy({
                      by: ['generalId'],
                      where: {
                          generalId: { in: generalIds },
                          category: LogCategory.BATTLE_BRIEF,
                      },
                      _count: { _all: true },
                  })
                : [];
        const battleCountMap = new Map<number, number>();
        for (const row of battleCounts) {
            if (row.generalId !== null) {
                battleCountMap.set(row.generalId, row._count._all);
            }
        }

        const generals = generalRows.map((general) => ({
            id: general.id,
            name: general.name,
            npcState: general.npcState,
            officerLevel: general.officerLevel,
            cityId: general.cityId,
            turnTime: formatDateTime(general.turnTime),
            recentWar: formatDateTime(general.recentWarTime),
            warnum: battleCountMap.get(general.id) ?? 0,
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
            train: general.train,
            atmos: general.atmos,
        }));

        return {
            me: {
                id: me.id,
                officerLevel: me.officerLevel,
                permissionLevel,
            },
            nation: {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                level: nation.level,
            },
            currentYear: worldState.currentYear,
            currentMonth: worldState.currentMonth,
            turnTermMinutes: Math.max(1, Math.round(worldState.tickSeconds / 60)),
            generals,
        };
    }),
    getGeneralLog: authedProcedure
        .input(
            z.object({
                generalId: z.number().int().positive(),
                type: zGeneralLogType,
            })
        )
        .query(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertNationAccess(me);

            const [nation, target] = await Promise.all([
                ctx.db.nation.findUnique({
                    where: { id: me.nationId },
                    select: { meta: true },
                }),
                ctx.db.general.findUnique({
                    where: { id: input.generalId },
                    select: { id: true, nationId: true, npcState: true },
                }),
            ]);

            if (!nation) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
            }
            if (!target) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'General not found' });
            }

            const permissionLevel = resolveNationPermission(me, nation.meta, true);
            if (permissionLevel < 1) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
            }
            if (target.nationId !== me.nationId) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '같은 나라의 장수가 아닙니다.' });
            }
            if (
                input.type === 'generalAction' &&
                target.npcState < 2 &&
                target.id !== me.id &&
                permissionLevel < 2
            ) {
                throw new TRPCError({
                    code: 'FORBIDDEN',
                    message: '권한이 부족합니다. 유저 장수의 개인 기록은 수뇌만 열람 가능합니다.',
                });
            }

            const categoryMap: Record<GeneralLogType, LogCategory> = {
                generalHistory: LogCategory.HISTORY,
                generalAction: LogCategory.ACTION,
                battleResult: LogCategory.BATTLE_BRIEF,
                battleDetail: LogCategory.BATTLE_DETAIL,
            };

            const logs = await ctx.db.logEntry.findMany({
                where: {
                    generalId: target.id,
                    scope: LogScope.GENERAL,
                    category: categoryMap[input.type],
                },
                orderBy: { id: 'desc' },
                take: 30,
            });

            return {
                type: input.type,
                generalId: target.id,
                logs: logs.map((entry) => ({
                    id: entry.id,
                    text: entry.text,
                })),
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
