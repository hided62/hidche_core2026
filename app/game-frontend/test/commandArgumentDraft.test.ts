import assert from 'node:assert/strict';
import test from 'node:test';
import {
    commandArgumentFieldContract,
    shouldPreserveCommandArgumentValue,
} from '../src/components/command/commandArgumentDraft.ts';
import type { CommandInputField, CommandOption } from '../src/components/command/types.ts';

const field = (kind: CommandInputField['kind'], optionSource?: CommandInputField['optionSource']): CommandInputField => ({
    key: 'value',
    label: '값',
    kind,
    required: true,
    optionSource,
});

void test('preserves every user-editable non-select command argument across data refreshes', () => {
    for (const [kind, value] of [
        ['text', '작성 중인 국명'],
        ['number', 777],
        ['boolean', false],
        ['numberTuple', [111, 222]],
    ] as const) {
        const currentField = field(kind);
        assert.equal(
            shouldPreserveCommandArgumentValue(
                currentField,
                commandArgumentFieldContract(currentField),
                { value },
                []
            ),
            true,
            kind
        );
    }
});

void test('preserves a select only while its field contract and selected option remain available', () => {
    const currentField = field('select', 'cities');
    const options: CommandOption[] = [
        { value: 1, label: '업' },
        { value: 2, label: '허창' },
    ];
    assert.equal(
        shouldPreserveCommandArgumentValue(
            currentField,
            commandArgumentFieldContract(currentField),
            { value: 2 },
            options
        ),
        true
    );
    assert.equal(
        shouldPreserveCommandArgumentValue(
            currentField,
            commandArgumentFieldContract(currentField),
            { value: 3 },
            options
        ),
        false
    );
    assert.equal(
        shouldPreserveCommandArgumentValue(currentField, { kind: 'select', optionSource: 'nations' }, { value: 2 }, options),
        false
    );
});

void test('reinitializes hidden, new, and changed-kind fields', () => {
    const hidden = field('hidden');
    assert.equal(
        shouldPreserveCommandArgumentValue(hidden, commandArgumentFieldContract(hidden), { value: 'old' }, []),
        false
    );
    const text = field('text');
    assert.equal(shouldPreserveCommandArgumentValue(text, undefined, { value: 'old' }, []), false);
    assert.equal(shouldPreserveCommandArgumentValue(text, { kind: 'number' }, { value: 'old' }, []), false);
    assert.equal(
        shouldPreserveCommandArgumentValue(text, commandArgumentFieldContract(text), {}, []),
        false
    );
});
