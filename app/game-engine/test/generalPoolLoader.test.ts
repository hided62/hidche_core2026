import { describe, expect, it } from 'vitest';

import { loadGeneralPoolEntries } from '../src/scenario/generalPoolLoader.js';

describe('SPoolUnderU30 resource', () => {
    it('preserves the Ref UnderS30 row contract and ordering', async () => {
        const entries = await loadGeneralPoolEntries('SPoolUnderU30');
        const weights = entries.map((entry) => {
            const dex = entry.info.dex as number[];
            return dex.reduce((sum, value) => sum + value, 0);
        });

        expect(entries).toHaveLength(1844);
        expect(new Set(entries.map((entry) => entry.uniqueName)).size).toBe(1844);
        expect(Math.min(...weights)).toBe(100122);
        expect(Math.max(...weights)).toBe(2582699);
        const traitFrequencies = entries.reduce<Record<string, number>>((result, entry) => {
            const key = String(entry.info.specialDomestic);
            result[key] = (result[key] ?? 0) + 1;
            return result;
        }, {});
        expect(traitFrequencies).toEqual({
            che_event_격노: 152,
            che_event_견고: 91,
            che_event_공성: 8,
            che_event_궁병: 12,
            che_event_귀병: 38,
            che_event_기병: 12,
            che_event_돌격: 98,
            che_event_무쌍: 100,
            che_event_반계: 81,
            che_event_보병: 10,
            che_event_신산: 99,
            che_event_신중: 106,
            che_event_위압: 85,
            che_event_의술: 37,
            che_event_저격: 251,
            che_event_집중: 125,
            che_event_징병: 169,
            che_event_척사: 166,
            che_event_필살: 156,
            che_event_환술: 48,
        });
        expect(entries[0]).toEqual({
            uniqueName: '⑨탈곡기',
            info: {
                generalName: '⑨탈곡기',
                leadership: 69,
                strength: 12,
                intel: 80,
                specialDomestic: 'che_event_징병',
                dex: [12066, 27302, 29463, 307356, 16448],
                imgsvr: 1,
                picture: '9ed8be6.gif?=20190417',
                uniqueName: '⑨탈곡기',
            },
        });
        expect(entries.at(-1)?.uniqueName).toBe('④야부키 나코');
    });

    it('rejects an unsupported pool instead of silently substituting data', async () => {
        await expect(loadGeneralPoolEntries('SPoolUnknown')).rejects.toThrow('Unsupported general pool');
    });
});
