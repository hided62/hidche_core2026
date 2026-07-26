import {
    GENERAL_TURN_COMMAND_KEYS,
    NATION_TURN_COMMAND_KEYS,
    loadGeneralTurnCommandSpecs,
    loadNationTurnCommandSpecs,
} from '@sammo-ts/logic';
import { describe, expect, it } from 'vitest';

import {
    buildTurnCommandInputFields,
    parseReservedTurnArgs,
} from '../src/turns/commandInput.js';

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

        expect(argumentSpecs).toHaveLength(44);
        expect(fields.every((entry) => entry.fields.length > 0)).toBe(true);
        expect(fields.find((entry) => entry.key === 'che_화계')?.fields).toMatchObject([
            { key: 'destCityId', kind: 'select', optionSource: 'cities' },
        ]);
        expect(fields.find((entry) => entry.key === 'che_물자원조')?.fields).toMatchObject([
            { key: 'destNationId', kind: 'select', optionSource: 'nations' },
            { key: 'amountList', kind: 'numberTuple' },
        ]);
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
        await expect(parseReservedTurnArgs('general', 'che_포상', {})).rejects.toThrow(
            'Unknown general turn command'
        );
    });
});
