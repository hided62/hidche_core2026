import { describe, expect, it } from 'vitest';

import {
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
});
