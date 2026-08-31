import assert from 'node:assert/strict';
import test from 'node:test';

import { sortCommandGeneralOptions } from '../src/components/command/commandGeneralOptions.ts';
import type { CommandOption } from '../src/components/command/types.ts';

const option = (value: number, npcState: number | undefined, fields: Partial<CommandOption> = {}): CommandOption => ({
    value,
    label: String(value),
    npcState,
    ...fields,
});

void test('puts user generals before possessed and NPC types for general target commands', () => {
    const options = [option(4, 3), option(3, 2), option(2, 1), option(1, 0), option(5, undefined)];

    assert.deepEqual(
        sortCommandGeneralOptions('che_발령', options, true).map(({ value }) => value),
        [1, 5, 2, 3, 4]
    );
    assert.deepEqual(
        options.map(({ value }) => value),
        [4, 3, 2, 1, 5]
    );
});

void test('keeps reward and confiscation resource order inside each general type', () => {
    const options = [
        option(3, 2, { gold: 300, rice: 500 }),
        option(1, 0, { gold: 500, rice: 100 }),
        option(4, 2, { gold: 100, rice: 900 }),
        option(2, 0, { gold: 200, rice: 400 }),
    ];

    assert.deepEqual(
        sortCommandGeneralOptions('che_포상', options, true).map(({ value }) => value),
        [2, 1, 4, 3]
    );
    assert.deepEqual(
        sortCommandGeneralOptions('che_포상', options, false).map(({ value }) => value),
        [1, 2, 3, 4]
    );
    assert.deepEqual(
        sortCommandGeneralOptions('che_몰수', options, true).map(({ value }) => value),
        [1, 2, 3, 4]
    );
});

void test('keeps troop-exit availability order inside each general type', () => {
    const options = [
        option(3, 2, { availableNow: true }),
        option(1, 0, { availableNow: false }),
        option(4, 2, { availableNow: false }),
        option(2, 0, { availableNow: true }),
    ];

    assert.deepEqual(
        sortCommandGeneralOptions('che_부대탈퇴지시', options, true).map(({ value }) => value),
        [2, 1, 3, 4]
    );
});
