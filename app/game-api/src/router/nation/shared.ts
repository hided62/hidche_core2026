import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asNumber, asRecord } from '@sammo-ts/common';
import {
    createIncomeActionContext,
    DomesticTraitLoader,
    EventDomesticTraitLoader,
    isDomesticTraitKey,
    isEventDomesticTraitKey,
    isNationTraitKey,
    isPersonalityTraitKey,
    isWarTraitKey,
    loadDomesticTraitModules,
    loadEventDomesticTraitModules,
    loadNationTraitModules,
    loadPersonalityTraitModules,
    loadWarTraitModules,
    NationTraitLoader,
    PersonalityTraitLoader,
    WarTraitLoader,
    type CityIncomeSource,
    type Nation as LogicNation,
    type NationIncomeContext,
    type TriggerNationalIncomeType,
    type TriggerValue,
} from '@sammo-ts/logic';

import type { GameApiContext, InputJsonValue, WorldStateRow } from '../../context.js';
import { purifyNationHtml } from '../../security/nationHtml.js';
import { resolveSecretPermission } from '../shared/secretPermission.js';

export type PermissionKind = 'normal' | 'ambassador' | 'auditor';

export type TraitNameMap = Map<string, { name: string; info: string }>;

export type TraitCache = {
    domestic: TraitNameMap;
    war: TraitNameMap;
    personality: TraitNameMap;
    nation: TraitNameMap;
};

export type NationTraitModule = Awaited<ReturnType<typeof loadNationTraitModules>>[number] | null;

export type NationIncomeRow = {
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

export type CityIncomeRow = {
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
    trade: number | null;
    defence: number;
    defenceMax: number;
    wall: number;
    wallMax: number;
    supplyState: number;
    frontState: number;
    meta: unknown;
};

export type GeneralListRow = {
    id: number;
    name: string;
    npcState: number;
    nationId: number;
    cityId: number;
    troopId: number;
    picture?: string | null;
    imageServer?: number;
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

export type GeneralOfficerRow = {
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

export type NationCountRow = {
    nationId: number;
    count: number;
};

export type NationStratRow = {
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

export type DiplomacyRow = {
    destNationId: number;
    stateCode: number;
    term: number;
};

export type GeneralPowerRow = {
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
export const MAX_AVAILABLE_WAR_SETTING_CNT = 10;
export const INC_AVAILABLE_WAR_SETTING_CNT = 2;

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

export const resolveOfficerCity = (meta: Record<string, unknown>): number => {
    const camel = readMetaNumber(meta, 'officerCity', 0);
    if (camel > 0) {
        return camel;
    }
    return readMetaNumber(meta, 'officer_city', 0);
};

export const resolveBelong = (meta: Record<string, unknown>): number => readMetaNumber(meta, 'belong', 0);

export const resolvePermission = (meta: Record<string, unknown>): PermissionKind => {
    const value = meta.permission;
    if (value === 'ambassador' || value === 'auditor') {
        return value;
    }
    return 'normal';
};

export const resolveChiefStatMin = (worldState: WorldStateRow | null): number => {
    if (!worldState) {
        return DEFAULT_CHIEF_STAT_MIN;
    }
    const config = asRecord(worldState.config);
    const stat = asRecord(config.stat);
    return asNumber(stat.chiefMin, DEFAULT_CHIEF_STAT_MIN);
};

export const resolveNationRate = (nation: NationIncomeRow): number => {
    const meta = asRecord(nation.meta);
    return asNumber(meta.rate, 20);
};

export const toIncomeCity = (city: CityIncomeRow): CityIncomeSource => ({
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

export const resolveNationBill = (meta: Record<string, unknown>): number => readMetaNumber(meta, 'bill', 100);

export const resolveNationSecretLimit = (meta: Record<string, unknown>): number => {
    const legacy = readMetaNumber(meta, 'secretlimit', -1);
    if (legacy >= 0) {
        return legacy;
    }
    return readMetaNumber(meta, 'secretLimit', 3);
};

export const resolveNationBlockWar = (meta: Record<string, unknown>): boolean =>
    readMetaBool(meta, 'war', readMetaBool(meta, 'blockWar', false));

export const resolveNationBlockScout = (meta: Record<string, unknown>): boolean =>
    readMetaBool(meta, 'scout', readMetaBool(meta, 'blockScout', false));

export const resolveNationNotice = (meta: Record<string, unknown>): string =>
    purifyNationHtml(typeof meta.notice === 'string' ? meta.notice : '');

export const resolveNationScoutMessage = (meta: Record<string, unknown>): string =>
    purifyNationHtml(typeof meta.infoText === 'string' ? meta.infoText : '');

export const resolveWarSettingRemain = (meta: Record<string, unknown>): number => {
    const legacy = readMetaNumber(meta, 'available_war_setting_cnt', -1);
    const fallback =
        legacy >= 0 ? legacy : readMetaNumber(meta, 'availableWarSettingCnt', MAX_AVAILABLE_WAR_SETTING_CNT);
    return Math.max(0, Math.min(MAX_AVAILABLE_WAR_SETTING_CNT, fallback));
};

export const checkSecretMaxPermission = (penalty: Record<string, unknown>): number => {
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

export const loadTraitNames = async (keys: Array<string | null>, kind: keyof TraitCache): Promise<TraitNameMap> => {
    const cache = traitCache[kind];
    const unique = Array.from(new Set(keys.filter((key): key is string => Boolean(key))));
    const missing = unique.filter((key) => !cache.has(key));

    if (!missing.length) {
        return cache;
    }

    if (kind === 'domestic') {
        const filtered = missing.filter((key) => isDomesticTraitKey(key));
        const eventFiltered = missing.filter((key) => isEventDomesticTraitKey(key));
        if (filtered.length) {
            const modules = await loadDomesticTraitModules(filtered, new DomesticTraitLoader());
            for (const module of modules) {
                cache.set(module.key, { name: module.name, info: module.info ?? '' });
            }
        }
        if (eventFiltered.length) {
            const modules = await loadEventDomesticTraitModules(
                eventFiltered,
                new EventDomesticTraitLoader()
            );
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

export const buildNationIncomeContext = async (nation: NationIncomeRow): Promise<NationIncomeContext> => {
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

export const formatDateTime = (value: Date | null): string => {
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

export const zGeneralLogType = z.enum(['generalHistory', 'generalAction', 'battleResult', 'battleDetail']);
export type GeneralLogType = z.infer<typeof zGeneralLogType>;

export const assertNationAccess = (general: { nationId: number; officerLevel: number }) => {
    if (general.nationId <= 0 || general.officerLevel <= 0) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Nation membership required.' });
    }
};

export const resolveNationPermission = (
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

export const assertNationEditable = (
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

export const updateNationMeta = async (
    ctx: Pick<GameApiContext, 'turnDaemon'>,
    nationId: number,
    updates: Record<string, unknown>,
    currentMeta: Record<string, unknown>
): Promise<InputJsonValue> => {
    const expectedUpdatedAt = typeof currentMeta._updatedAt === 'string' ? currentMeta._updatedAt : undefined;
    const result = await ctx.turnDaemon.requestCommand({
        type: 'setNationMeta',
        nationId,
        updates,
        expectedUpdatedAt,
    });
    if (!result || result.type !== 'setNationMeta') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
    }
    if (!result.ok) {
        if (result.reason === 'CONFLICT') {
            throw new TRPCError({
                code: 'CONFLICT',
                message: '다른 사용자가 정책을 변경했습니다. 재시도하거나 현재 상태로 갱신해주세요.',
            });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
    }
    return {
        ...currentMeta,
        ...updates,
        _updatedAt: result.updatedAt,
    } as InputJsonValue;
};

export const mapGeneralList = async (
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
            picture: general.picture ?? null,
            imageServer: general.imageServer ?? 0,
            officerCity,
            officerCityName: officerCity > 0 ? (cityNameMap.get(officerCity) ?? null) : null,
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
                      info: personalityMap.get(personalityKey)?.info ?? '',
                  }
                : null,
            specialDomestic: domesticKey
                ? {
                      key: domesticKey,
                      name: domesticMap.get(domesticKey)?.name ?? domesticKey,
                      info: domesticMap.get(domesticKey)?.info ?? '',
                  }
                : null,
            specialWar: warKey
                ? {
                      key: warKey,
                      name: warMap.get(warKey)?.name ?? warKey,
                      info: warMap.get(warKey)?.info ?? '',
                  }
                : null,
            belong,
            permission,
        };
    });
};
