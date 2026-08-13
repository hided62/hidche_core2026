import { asRecord } from '@sammo-ts/common';
import { isItemKey, ItemLoader } from '@sammo-ts/logic';
import { loadUnitSetDefinitionByName } from '@sammo-ts/game-engine/scenario/unitSetLoader.js';

import type { WorldStateRow } from '../context.js';

const NATION_LEVEL_NAMES: Record<number, string> = {
    0: '방랑군',
    1: '호족',
    2: '군벌',
    3: '주자사',
    4: '주목',
    5: '공',
    6: '왕',
    7: '황제',
};

const CITY_LEVEL_NAMES: Record<number, string> = {
    1: '수',
    2: '진',
    3: '관',
    4: '이',
    5: '소',
    6: '중',
    7: '대',
    8: '특',
};

const REGION_NAMES: Record<number, string> = {
    1: '하북',
    2: '중원',
    3: '서북',
    4: '서촉',
    5: '남중',
    6: '초',
    7: '오월',
    8: '동이',
};

const OFFICER_LEVEL_NAMES: Record<number, string> = {
    12: '군주',
    11: '참모',
    10: '제1장군',
    9: '제1모사',
    8: '제2장군',
    7: '제2모사',
    6: '제3장군',
    5: '제3모사',
    4: '태수',
    3: '군사',
    2: '종사',
    1: '일반',
    0: '재야',
};

const OFFICER_LEVEL_NAMES_BY_NATION_LEVEL: Record<number, Record<number, string>> = {
    7: { 12: '황제', 11: '승상', 10: '표기장군', 9: '사공', 8: '거기장군', 7: '태위', 6: '위장군', 5: '사도' },
    6: { 12: '왕', 11: '광록훈', 10: '좌장군', 9: '상서령', 8: '우장군', 7: '중서령', 6: '전장군', 5: '비서령' },
    5: { 12: '공', 11: '광록대부', 10: '안국장군', 9: '집금오', 8: '파로장군', 7: '소부' },
    4: { 12: '주목', 11: '태사령', 10: '아문장군', 9: '낭중', 8: '호군', 7: '종사중랑' },
    3: { 12: '주자사', 11: '주부', 10: '편장군', 9: '간의대부' },
    2: { 12: '군벌', 11: '참모', 10: '비장군', 9: '부참모' },
    1: { 12: '영주', 11: '참모' },
    0: { 12: '두목', 11: '부두목' },
};

export const sanitizeInternalDisplayCode = (value: string | null | undefined): string => {
    if (!value || value === 'None') {
        return '-';
    }
    if (/^\d+$/u.test(value)) {
        return '-';
    }
    return value.replace(/^che_(?:event_)?/u, '');
};

export const resolveNationLevelName = (level: number): string => NATION_LEVEL_NAMES[level] ?? '-';

export const resolveCityLevelName = (level: number): string => CITY_LEVEL_NAMES[level] ?? '-';

export const resolveRegionName = (region: number): string => REGION_NAMES[region] ?? '-';

export const resolveOfficerLevelName = (officerLevel: number, nationLevel?: number): string => {
    if (officerLevel < 5) {
        return OFFICER_LEVEL_NAMES[officerLevel] ?? '-';
    }
    if (nationLevel === undefined) {
        return OFFICER_LEVEL_NAMES[officerLevel] ?? '-';
    }
    return OFFICER_LEVEL_NAMES_BY_NATION_LEVEL[nationLevel]?.[officerLevel] ?? '-';
};

export const resolveDedicationLevelName = (dedicationLevel: number, maxDedicationLevel: number): string => {
    if (dedicationLevel <= 0) {
        return '무품관';
    }
    return `${Math.max(1, maxDedicationLevel - dedicationLevel + 1)}품관`;
};

const resolveUnitSetName = (world: Pick<WorldStateRow, 'config'> | null, fallback: string): string => {
    const config = asRecord(world?.config);
    const environment = asRecord(config.environment ?? config.map);
    return typeof environment.unitSet === 'string' && environment.unitSet.trim() ? environment.unitSet : fallback;
};

const crewTypeNameCache = new Map<string, Promise<Map<number, string>>>();

export const loadCrewTypeDisplayNames = (
    world: Pick<WorldStateRow, 'config'> | null,
    fallback: string
): Promise<Map<number, string>> => {
    const unitSetName = resolveUnitSetName(world, fallback);
    const cached = crewTypeNameCache.get(unitSetName);
    if (cached) {
        return cached;
    }
    const pending = loadUnitSetDefinitionByName(unitSetName)
        .then((definition) => new Map((definition.crewTypes ?? []).map((crewType) => [crewType.id, crewType.name])))
        .catch(() => new Map<number, string>());
    crewTypeNameCache.set(unitSetName, pending);
    return pending;
};

const itemLoader = new ItemLoader();

export const loadItemDisplayNames = async (values: Array<string | null | undefined>): Promise<Map<string, string>> => {
    const keys = Array.from(new Set(values.filter((value): value is string => Boolean(value) && value !== 'None')));
    const entries = await Promise.all(
        keys.map(async (key) => {
            if (!isItemKey(key)) {
                return [key, sanitizeInternalDisplayCode(key)] as const;
            }
            const item = await itemLoader.load(key).catch(() => null);
            return [key, item?.name ?? sanitizeInternalDisplayCode(key)] as const;
        })
    );
    return new Map(entries);
};
