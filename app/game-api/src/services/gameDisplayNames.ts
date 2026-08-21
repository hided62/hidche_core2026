import { asRecord } from '@sammo-ts/common';
import { isItemKey, ItemLoader } from '@sammo-ts/logic';
import { loadUnitSetDefinitionByName } from '@sammo-ts/game-engine/scenario/unitSetLoader.js';
import type { CrewTypeDefinition, CrewTypeRequirement } from '@sammo-ts/logic/world/types.js';

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

export interface CrewTypeDisplayDetails {
    name: string;
    info: string[];
    requirements: string[];
    stats: {
        attack: number;
        defence: number;
        speed: number;
        avoid: number;
        magicCoef: number;
        cost: number;
        rice: number;
    };
}

const KNOWN_NATION_AUX_LABELS: Readonly<Record<string, string>> = {
    can_대검병사용: '대검병 연구',
    can_극병사용: '극병 연구',
    can_화시병사용: '화시병 연구',
    can_원융노병사용: '원융노병 연구',
    can_산저병사용: '산저병 연구',
    can_상병사용: '상병 연구',
    can_음귀병사용: '음귀병 연구',
    can_무희사용: '무희 연구',
    can_화륜차사용: '화륜차 연구',
    did_특성초토화: '특성 초토화',
};

const formatNationAuxRequirement = (requirement: {
    type: 'ReqNationAux';
    key: string;
    op: string;
    value: number | string;
}): string => {
    const knownLabel = KNOWN_NATION_AUX_LABELS[requirement.key];
    if (knownLabel && requirement.key !== 'did_특성초토화' && requirement.op === '==' && requirement.value === 1) {
        return `${knownLabel} 시 가능`;
    }
    if (requirement.key === 'did_특성초토화' && requirement.op === '>=' && requirement.value === 1) {
        return `${knownLabel ?? requirement.key} 시 가능`;
    }
    if (requirement.op === '==' && requirement.value === 0) return `${requirement.key} 없을 때`;
    if (requirement.op === '==' && requirement.value === 1) return `${requirement.key} 있을 때`;
    if (requirement.op === '!=' && requirement.value === 0) return `${requirement.key} 없을 때`;
    if (requirement.op === '!=' && requirement.value === 1) return `${requirement.key} 있을 때`;
    const operator = requirement.op === '==' ? '=' : requirement.op;
    return `${requirement.key} ${operator} ${String(requirement.value)} 일 때`;
};

export const formatCrewTypeRequirement = (requirement: CrewTypeRequirement): string => {
    switch (requirement.type) {
        case 'ReqTech': {
            const detail = requirement as { type: 'ReqTech'; tech: number };
            return `기술력 ${detail.tech} 이상 필요`;
        }
        case 'ReqRegions': {
            const detail = requirement as { type: 'ReqRegions'; regions: string[] };
            return `${detail.regions.join(', ')} 지역 소유시 가능`;
        }
        case 'ReqCities': {
            const detail = requirement as { type: 'ReqCities'; cities: string[] };
            return `${detail.cities.join(', ')} 소유시 가능`;
        }
        case 'ReqCitiesWithCityLevel': {
            const detail = requirement as { type: 'ReqCitiesWithCityLevel'; level: number; cities: string[] };
            return `${detail.cities.join(', ')} ${resolveCityLevelName(detail.level)}성 소유시 가능`;
        }
        case 'ReqHighLevelCities': {
            const detail = requirement as { type: 'ReqHighLevelCities'; level: number; count: number };
            return `${resolveCityLevelName(detail.level)}성 ${detail.count}개 이상 소유시 가능`;
        }
        case 'ReqNationAux':
            return formatNationAuxRequirement(
                requirement as { type: 'ReqNationAux'; key: string; op: string; value: number | string }
            );
        case 'ReqMinRelYear': {
            const detail = requirement as { type: 'ReqMinRelYear'; year: number };
            return `${detail.year}년 경과 후 사용 가능`;
        }
        case 'ReqChief':
            return '군주 및 수뇌부만 가능';
        case 'ReqNotChief':
            return '군주 및 수뇌부는 불가';
        case 'Impossible':
            return '불가능';
        default:
            return '';
    }
};

const crewTypeDetailsCache = new Map<string, Promise<Map<number, CrewTypeDisplayDetails>>>();

const toCrewTypeDisplayDetails = (crewType: CrewTypeDefinition): CrewTypeDisplayDetails => ({
    name: crewType.name,
    info: crewType.info.filter(Boolean),
    requirements: crewType.requirements.map(formatCrewTypeRequirement).filter(Boolean),
    stats: {
        attack: crewType.attack,
        defence: crewType.defence,
        speed: crewType.speed,
        avoid: crewType.avoid,
        magicCoef: crewType.magicCoef,
        cost: crewType.cost,
        rice: crewType.rice,
    },
});

export const loadCrewTypeDisplayDetails = (
    world: Pick<WorldStateRow, 'config'> | null,
    fallback: string
): Promise<Map<number, CrewTypeDisplayDetails>> => {
    const unitSetName = resolveUnitSetName(world, fallback);
    const cached = crewTypeDetailsCache.get(unitSetName);
    if (cached) {
        return cached;
    }
    const pending = loadUnitSetDefinitionByName(unitSetName)
        .then(
            (definition) =>
                new Map(
                    (definition.crewTypes ?? []).map((crewType) => [crewType.id, toCrewTypeDisplayDetails(crewType)])
                )
        )
        .catch(() => new Map<number, CrewTypeDisplayDetails>());
    crewTypeDetailsCache.set(unitSetName, pending);
    return pending;
};

export const loadCrewTypeDisplayNames = (
    world: Pick<WorldStateRow, 'config'> | null,
    fallback: string
): Promise<Map<number, string>> =>
    loadCrewTypeDisplayDetails(world, fallback).then(
        (details) => new Map(Array.from(details, ([id, detail]) => [id, detail.name]))
    );

const itemLoader = new ItemLoader();

export interface ItemDisplayDetails {
    name: string;
    info: string;
}

export const loadItemDisplayDetails = async (
    values: Array<string | null | undefined>
): Promise<Map<string, ItemDisplayDetails>> => {
    const keys = Array.from(new Set(values.filter((value): value is string => Boolean(value) && value !== 'None')));
    const entries = await Promise.all(
        keys.map(async (key) => {
            if (!isItemKey(key)) {
                return [key, { name: sanitizeInternalDisplayCode(key), info: '' }] as const;
            }
            const item = await itemLoader.load(key).catch(() => null);
            return [
                key,
                {
                    name: item?.name ?? sanitizeInternalDisplayCode(key),
                    info: item?.info ?? '',
                },
            ] as const;
        })
    );
    return new Map(entries);
};

export const loadItemDisplayNames = async (values: Array<string | null | undefined>): Promise<Map<string, string>> => {
    const details = await loadItemDisplayDetails(values);
    return new Map(Array.from(details, ([key, detail]) => [key, detail.name]));
};
