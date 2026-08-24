import { describe, expect, it } from 'vitest';
import type { Nation } from '@sammo-ts/logic';

import { buildOldNationArchiveData } from '../src/turn/oldNationArchive.js';

describe('old nation archive data', () => {
    it('writes one canonical public shape for winner and deleted-nation readers', () => {
        const nation: Nation = {
            id: 2,
            name: '위',
            color: '#0000ff',
            capitalCityId: 3,
            chiefGeneralId: 7,
            gold: 1_000,
            rice: 2_000,
            power: 8_000,
            level: 5,
            typeCode: 'che_법가',
            meta: {
                tech: 3_000,
                aux: { legacy: 'preserved' },
                max_power: { maxPower: 20_000, maxCrew: 80_000, maxCities: ['허창'] },
            },
        };

        expect(buildOldNationArchiveData({ nation, generalIds: [7, 8], history: ['위가 멸망'] })).toMatchObject({
            nation: 2,
            name: '위',
            type: 'che_법가',
            typeCode: 'che_법가',
            tech: 3_000,
            power: 8_000,
            maxPower: 20_000,
            maxCrew: 80_000,
            maxCities: ['허창'],
            aux: { legacy: 'preserved', maxPower: 20_000, maxCrew: 80_000, maxCities: ['허창'] },
            generals: [7, 8],
            history: ['위가 멸망'],
            msg: '',
            scout_msg: null,
        });
    });

    it('prefers current notice fields and preserves empty strings', () => {
        const nation: Nation = {
            id: 2,
            name: '위',
            color: '#0000ff',
            capitalCityId: 3,
            chiefGeneralId: 7,
            gold: 1_000,
            rice: 2_000,
            power: 8_000,
            level: 5,
            typeCode: 'che_법가',
            meta: {
                notice: '',
                infoText: '',
                nationNotice: { msg: 'legacy notice' },
                msg: 'legacy flat notice',
                scout_msg: 'legacy scout message',
            },
        };

        expect(buildOldNationArchiveData({ nation, generalIds: [], history: [] })).toMatchObject({
            msg: '',
            scout_msg: '',
        });
    });

    it('falls back to both legacy notice shapes and legacy scout text', () => {
        const baseNation: Nation = {
            id: 2,
            name: '위',
            color: '#0000ff',
            capitalCityId: 3,
            chiefGeneralId: 7,
            gold: 1_000,
            rice: 2_000,
            power: 8_000,
            level: 5,
            typeCode: 'che_법가',
            meta: {
                nationNotice: { msg: 'legacy notice' },
                msg: 'legacy flat notice',
                scout_msg: 'legacy scout message',
            },
        };

        expect(buildOldNationArchiveData({ nation: baseNation, generalIds: [], history: [] })).toMatchObject({
            msg: 'legacy notice',
            scout_msg: 'legacy scout message',
        });
        expect(
            buildOldNationArchiveData({
                nation: { ...baseNation, meta: { msg: 'legacy flat notice' } },
                generalIds: [],
                history: [],
            })
        ).toMatchObject({ msg: 'legacy flat notice', scout_msg: null });
    });
});
