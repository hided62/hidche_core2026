import {
    GENERAL_TURN_COMMAND_KEYS,
    NATION_TURN_COMMAND_KEYS,
    loadGeneralTurnCommandSpecs,
    loadNationTurnCommandSpecs,
} from '@sammo-ts/logic';
import { describe, expect, it } from 'vitest';

import {
    buildEquipmentTradeItemOptions,
    buildTurnCommandInputFields,
    parseReservedTurnArgs,
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
