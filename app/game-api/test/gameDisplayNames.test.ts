import { describe, expect, it } from 'vitest';

import {
    formatCrewTypeRequirement,
    resolveCityLevelName,
    resolveDedicationLevelName,
    resolveNationLevelName,
    resolveOfficerLevelName,
    resolveRegionName,
    sanitizeInternalDisplayCode,
} from '../src/services/gameDisplayNames.js';

describe('Ref GUI display names', () => {
    it('maps nation, city, region, office, and dedication levels to Ref labels', () => {
        expect(resolveNationLevelName(3)).toBe('주자사');
        expect(resolveCityLevelName(8)).toBe('특');
        expect(resolveRegionName(2)).toBe('중원');
        expect(resolveOfficerLevelName(9, 3)).toBe('간의대부');
        expect(resolveOfficerLevelName(5, 3)).toBe('-');
        expect(resolveOfficerLevelName(5)).toBe('제3모사');
        expect(resolveDedicationLevelName(2, 30)).toBe('29품관');
        expect(resolveDedicationLevelName(0, 30)).toBe('무품관');
    });

    it('never exposes internal prefixes or numeric fallback codes', () => {
        expect(sanitizeInternalDisplayCode('che_event_의병')).toBe('의병');
        expect(sanitizeInternalDisplayCode('che_법가')).toBe('법가');
        expect(sanitizeInternalDisplayCode('3')).toBe('-');
        expect(resolveNationLevelName(99)).toBe('-');
        expect(resolveCityLevelName(99)).toBe('-');
        expect(resolveRegionName(99)).toBe('-');
    });

    it('formats crew-type requirements with the same text as Ref tooltips', () => {
        expect(formatCrewTypeRequirement({ type: 'ReqTech', tech: 1_000 })).toBe('기술력 1000 이상 필요');
        expect(formatCrewTypeRequirement({ type: 'ReqRegions', regions: ['중원', '오월'] })).toBe(
            '중원, 오월 지역 소유시 가능'
        );
        expect(formatCrewTypeRequirement({ type: 'ReqCitiesWithCityLevel', level: 8, cities: ['완'] })).toBe(
            '완 특성 소유시 가능'
        );
        expect(formatCrewTypeRequirement({ type: 'ReqHighLevelCities', level: 7, count: 4 })).toBe(
            '대성 4개 이상 소유시 가능'
        );
        expect(formatCrewTypeRequirement({ type: 'ReqNationAux', key: 'can_대검병사용', op: '==', value: 1 })).toBe(
            '대검병 연구 시 가능'
        );
        expect(formatCrewTypeRequirement({ type: 'ReqNationAux', key: 'did_특성초토화', op: '>=', value: 1 })).toBe(
            '특성 초토화 시 가능'
        );
        expect(formatCrewTypeRequirement({ type: 'ReqMinRelYear', year: 3 })).toBe('3년 경과 후 사용 가능');
        expect(formatCrewTypeRequirement({ type: 'ReqChief' })).toBe('군주 및 수뇌부만 가능');
        expect(formatCrewTypeRequirement({ type: 'ReqNotChief' })).toBe('군주 및 수뇌부는 불가');
        expect(formatCrewTypeRequirement({ type: 'Impossible' })).toBe('불가능');
    });
});
