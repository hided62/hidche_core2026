import {
    GENERAL_TURN_COMMAND_KEYS,
    NATION_TURN_COMMAND_KEYS,
    loadGeneralTurnCommandSpecs,
    loadNationTurnCommandSpecs,
} from '@sammo-ts/logic';
import { loadScenarioDefinitionById } from '@sammo-ts/game-engine/scenario/scenarioLoader.js';
import { describe, expect, it } from 'vitest';

import {
    assertReservedTurnArgsPassLegacyBasicValidation,
    buildEquipmentTradeItemOptions,
    buildTurnCommandInputFields,
    parseReservedTurnArgs,
    sanitizeReservedTurnArgs,
} from '../src/turns/commandInput.js';

const buildShopItem = (key: string, name: string) => ({
    key,
    rawName: name,
    name,
    info: `${name}<br>설명`,
    slot: 'item' as const,
    cost: 100,
    buyable: true,
    consumable: false,
    reqSecu: 3000,
    unique: false,
});

describe('turn command argument input', () => {
    it('builds supported fields for every argument-bearing command module', async () => {
        const [general, nation] = await Promise.all([
            loadGeneralTurnCommandSpecs([...GENERAL_TURN_COMMAND_KEYS]),
            loadNationTurnCommandSpecs([...NATION_TURN_COMMAND_KEYS]),
        ]);
        const argumentSpecs = [...general, ...nation].filter((spec) => spec.reqArg);
        const fields = argumentSpecs.map((spec) => ({
            key: spec.key,
            fields: buildTurnCommandInputFields(spec),
        }));
        const nationFields = nation
            .filter((spec) => spec.reqArg)
            .map((spec) => ({ key: spec.key, fields: buildTurnCommandInputFields(spec) }));

        expect(argumentSpecs).toHaveLength(44);
        expect(fields.every((entry) => entry.fields.length > 0)).toBe(true);
        expect(fields.find((entry) => entry.key === 'che_화계')?.fields).toMatchObject([
            { key: 'destCityId', kind: 'select', optionSource: 'cities' },
        ]);
        expect(fields.find((entry) => entry.key === 'che_물자원조')?.fields).toMatchObject([
            { key: 'destNationId', kind: 'select', optionSource: 'nations' },
            { key: 'amountList', kind: 'numberTuple' },
        ]);

        expect(
            nationFields
                .filter((entry) => entry.key !== 'che_발령')
                .flatMap((entry) =>
                    entry.fields
                        .filter((field) => field.optionSource === 'cities' || field.optionSource === 'nations')
                        .map((field) => `${entry.key}:${field.optionSource}`)
                )
                .sort()
        ).toEqual(
            [
                'che_급습:nations',
                'che_물자원조:nations',
                'che_백성동원:cities',
                'che_불가침제의:nations',
                'che_불가침파기제의:nations',
                'che_선전포고:nations',
                'che_수몰:cities',
                'che_이호경식:nations',
                'che_종전제의:nations',
                'che_천도:cities',
                'che_초토화:cities',
                'che_피장파장:nations',
                'che_허보:cities',
                'cr_인구이동:cities',
            ].sort()
        );
    });

    it('normalizes valid arguments and rejects malformed or wrong-scope commands', async () => {
        await expect(parseReservedTurnArgs('general', 'che_화계', { destCityId: 7 })).resolves.toEqual({
            destCityId: 7,
        });
        await expect(parseReservedTurnArgs('general', 'che_화계', { destCityId: '7' })).rejects.toBeDefined();
        await expect(
            parseReservedTurnArgs('nation', 'che_포상', {
                isGold: true,
                amount: 200,
                destGeneralId: 7,
            })
        ).resolves.toEqual({
            isGold: true,
            amount: 200,
            destGeneralId: 7,
        });
        await expect(parseReservedTurnArgs('general', 'che_포상', {})).rejects.toThrow('Unknown general turn command');
    });

    it('keeps Ref common validation separate from command-specific required fields', async () => {
        expect(() => assertReservedTurnArgsPassLegacyBasicValidation({})).not.toThrow();
        expect(() =>
            assertReservedTurnArgsPassLegacyBasicValidation({
                isGold: true,
                amount: '1',
                destGeneralId: 7,
            })
        ).toThrow('턴이 입력되지 않았습니다.');
        expect(() => assertReservedTurnArgsPassLegacyBasicValidation({ month: '12', year: 0 })).not.toThrow();
        expect(() => assertReservedTurnArgsPassLegacyBasicValidation({ nationName: '0' })).not.toThrow();
        expect(() => assertReservedTurnArgsPassLegacyBasicValidation({ year: '0x10' })).toThrow(
            '턴이 입력되지 않았습니다.'
        );
        await expect(parseReservedTurnArgs('nation', 'che_국호변경', { nationName: '0' })).rejects.toBeDefined();
    });

    it('recursively sanitizes reserved command strings like Ref before command parsing', async () => {
        expect(
            sanitizeReservedTurnArgs({
                nationName: '  <신-국>#  ',
                nested: ['A/B', '0'],
            })
        ).toEqual({
            nationName: '&lt;신국&gt;',
            nested: ['AB', ''],
        });
        await expect(
            parseReservedTurnArgs('nation', 'che_국호변경', {
                nationName: '  <신-국>#  ',
            })
        ).resolves.toEqual({ nationName: '&lt;신국&gt;' });
        await expect(
            parseReservedTurnArgs('nation', 'che_피장파장', {
                destNationId: 2,
                commandType: 'che_-수몰',
            })
        ).resolves.toEqual({ destNationId: 2, commandType: 'che_수몰' });
    });

    it('rejects internal general commands before parsing their arguments or scenario overrides', async () => {
        await expect(parseReservedTurnArgs('general', 'che_NPC능동', {})).rejects.toThrow(
            'Unknown general turn command: che_NPC능동'
        );
        await expect(parseReservedTurnArgs('general', 'che_방랑', {})).rejects.toThrow(
            'Unknown general turn command: che_방랑'
        );
        await expect(
            parseReservedTurnArgs('general', 'che_등용수락', { destNationId: 1, destGeneralId: 2 })
        ).rejects.toThrow('Unknown general turn command: che_등용수락');

        await expect(
            parseReservedTurnArgs(
                'general',
                'che_NPC능동',
                { optionText: '순간이동', destCityId: 1 },
                {
                    availableGeneralCommand: {
                        내부: ['휴식', 'che_NPC능동'],
                    },
                }
            )
        ).rejects.toThrow('Unknown scenario general command key: che_NPC능동');
    });

    it('accepts and rejects reserved commands from the real 904/905/910/912 world config', async () => {
        const scenarioConsts = Object.fromEntries(
            await Promise.all(
                [904, 905, 910, 912].map(async (scenarioId) => [
                    scenarioId,
                    (await loadScenarioDefinitionById(scenarioId)).config.const,
                ])
            )
        ) as Record<number, Record<string, unknown>>;

        await expect(parseReservedTurnArgs('general', 'che_거병', {}, scenarioConsts[904])).rejects.toThrow(
            'Unknown general turn command: che_거병'
        );
        await expect(
            parseReservedTurnArgs('nation', 'che_선전포고', { destNationId: 2 }, scenarioConsts[904])
        ).rejects.toThrow('Unknown nation turn command: che_선전포고');

        await expect(
            parseReservedTurnArgs(
                'general',
                'che_무작위건국',
                { nationName: '신국', nationType: 'che_도적', colorType: 1 },
                scenarioConsts[905]
            )
        ).resolves.toEqual({ nationName: '신국', nationType: 'che_도적', colorType: 1 });
        await expect(parseReservedTurnArgs('nation', 'che_무작위수도이전', {}, scenarioConsts[905])).resolves.toEqual(
            {}
        );
        await expect(parseReservedTurnArgs('general', 'cr_맹훈련', {}, scenarioConsts[905])).rejects.toThrow(
            'Unknown general turn command: cr_맹훈련'
        );

        await expect(parseReservedTurnArgs('general', 'cr_맹훈련', {}, scenarioConsts[910])).resolves.toEqual({});
        await expect(
            parseReservedTurnArgs('nation', 'cr_인구이동', { destCityId: 7, amount: 1234 }, scenarioConsts[910])
        ).resolves.toEqual({ destCityId: 7, amount: 1234 });
        await expect(parseReservedTurnArgs('nation', 'che_무작위수도이전', {}, scenarioConsts[910])).rejects.toThrow(
            'Unknown nation turn command: che_무작위수도이전'
        );

        await expect(parseReservedTurnArgs('nation', 'event_대검병연구', {}, scenarioConsts[912])).resolves.toEqual({});
        await expect(parseReservedTurnArgs('nation', 'cr_인구이동', {}, scenarioConsts[912])).rejects.toThrow(
            'Unknown nation turn command: cr_인구이동'
        );
    });

    it('limits equipment trade options to the Ref default items when a scenario omits allItems', () => {
        const items = buildEquipmentTradeItemOptions({
            configConst: {},
            itemModules: [buildShopItem('che_치료_환약', '환약'), buildShopItem('event_전투특기_격노', '격노의 비급')],
            currentSecurity: 5000,
            generalGold: 1000,
        });

        expect(items.item.map((item) => item.value)).toEqual(['None', 'che_치료_환약']);
        expect(items.item[1]?.description).toBe('현재 구입 가능 · 가격 100 · 환약 · 설명');
    });

    it('shows only zero-count buyable items selected by an explicit scenario pool', () => {
        const items = buildEquipmentTradeItemOptions({
            configConst: {
                allItems: {
                    item: {
                        che_치료_환약: 1,
                        event_전투특기_격노: 0,
                    },
                },
            },
            itemModules: [buildShopItem('che_치료_환약', '환약'), buildShopItem('event_전투특기_격노', '격노의 비급')],
            currentSecurity: 2000,
            generalGold: 50,
        });

        expect(items.item.map((item) => item.value)).toEqual(['None', 'event_전투특기_격노']);
        expect(items.item[1]?.description).toContain('현재 구입 불가: 치안 3,000 필요');
    });
});
