import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTournamentMainPresentation } from '../src/utils/tournamentNavigation.ts';

void test('routes every active tournament stage except betting to its type-specific tournament button', () => {
    const expectedLabels = ['전력전', '통솔전', '일기토', '설전'];
    for (const [type, expectedLabel] of expectedLabels.entries()) {
        for (const stage of [1, 2, 3, 4, 5, 7, 8, 9, 10, 0]) {
            const presentation = resolveTournamentMainPresentation(stage, type);
            assert.equal(presentation.compactLabel, expectedLabel);
            assert.equal(presentation.to, '/tournament');
            assert.equal(presentation.active, true);
        }
    }
});

void test('routes the betting stage to the betting hall regardless of tournament type', () => {
    for (const type of [0, 1, 2, 3]) {
        const presentation = resolveTournamentMainPresentation(6, type);
        assert.equal(presentation.compactLabel, '베팅장');
        assert.equal(presentation.to, '/betting');
        assert.equal(presentation.active, true);
    }
});

void test('keeps the generic tournament button when no tournament state exists', () => {
    const presentation = resolveTournamentMainPresentation(0, null);
    assert.equal(presentation.compactLabel, '토너먼트');
    assert.equal(presentation.to, '/tournament');
    assert.equal(presentation.active, false);
});
