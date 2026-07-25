import { describe, expect, it } from 'vitest';

import { loadTraitNames, mapGeneralList, type GeneralListRow } from '../src/router/nation/shared.js';

describe('nation trait information', () => {
    it('returns ref-compatible names and descriptions for nation and general traits', async () => {
        const row: GeneralListRow = {
            id: 1,
            name: '특성장수',
            npcState: 0,
            nationId: 1,
            cityId: 1,
            troopId: 0,
            officerLevel: 1,
            leadership: 80,
            strength: 70,
            intel: 60,
            experience: 0,
            dedication: 0,
            injury: 0,
            gold: 1000,
            rice: 1000,
            crew: 1000,
            personalCode: 'che_패권',
            specialCode: 'che_상재',
            special2Code: 'che_기병',
            meta: {},
            penalty: {},
        };

        const [general] = await mapGeneralList([row], new Map([[1, '도시']]), new Map());
        expect(general?.personality).toEqual({
            key: 'che_패권',
            name: '패권',
            info: '훈련 +5, 징·모병 비용 +20%',
        });
        expect(general?.specialDomestic?.info).toContain('상업 투자');
        expect(general?.specialWar?.info).toContain('공격 시 대미지 +20%');

        const nation = (await loadTraitNames(['che_유가'], 'nation')).get('che_유가');
        expect(nation).toEqual({ name: '유가', info: '농상↑ 민심↑ 쌀수입↓' });
    });
});
