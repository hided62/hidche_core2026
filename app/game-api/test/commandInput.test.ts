import {
    GENERAL_TURN_COMMAND_KEYS,
    NATION_TURN_COMMAND_KEYS,
    loadGeneralTurnCommandSpecs,
    loadNationTurnCommandSpecs,
} from '@sammo-ts/logic';
import { describe, expect, it } from 'vitest';

import { buildTurnCommandInputFields, parseReservedTurnArgs } from '../src/turns/commandInput.js';

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
});
