import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildTournamentBracket } from '../src/utils/tournamentBracket.ts';

const participants = Array.from({ length: 16 }, (_, index) => ({
    id: index + 1,
    name: `장수${index + 1}`,
    picture: `${index + 1}.jpg`,
    imageServer: index % 2,
}));
const matches = [
    ...Array.from({ length: 8 }, (_, index) => ({
        id: index + 1,
        stage: 7,
        roundIndex: index,
        attackerId: index * 2 + 1,
        defenderId: index * 2 + 2,
        winnerId: index * 2 + 1,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
        id: 9 + index,
        stage: 8,
        roundIndex: index,
        attackerId: index * 4 + 1,
        defenderId: index * 4 + 3,
        winnerId: index * 4 + 1,
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
        id: 13 + index,
        stage: 9,
        roundIndex: index,
        attackerId: index * 8 + 1,
        defenderId: index * 8 + 5,
        winnerId: index * 8 + 1,
    })),
    { id: 15, stage: 10, roundIndex: 0, attackerId: 1, defenderId: 9, winnerId: 1 },
];

void describe('tournament bracket', () => {
    void it('keeps every general in the worker roundIndex order and marks the actual winner path', () => {
        const bracket = buildTournamentBracket(participants, matches, 1);

        assert.equal(bracket.champion.name, '장수1');
        assert.equal(bracket.champion.picture, '1.jpg');
        assert.equal(bracket.top16.slots[1]?.imageServer, 1);
        assert.deepEqual(
            bracket.top16.slots.map((slot) => slot.name),
            participants.map((participant) => participant.name)
        );
        assert.deepEqual(
            bracket.top16.slots.filter((slot) => slot.advanced).map((slot) => slot.id),
            [1, 3, 5, 7, 9, 11, 13, 15]
        );
        assert.deepEqual(
            bracket.final.slots.map((slot) => slot.id),
            [1, 9]
        );
    });

    void it('renders missing future rounds as stable empty slots without inventing generals', () => {
        const bracket = buildTournamentBracket(
            participants,
            matches.filter((match) => match.stage === 7)
        );

        assert.equal(bracket.champion.name, '-');
        assert.deepEqual(
            bracket.final.slots.map((slot) => slot.name),
            ['-', '-']
        );
        assert.equal(bracket.top16.slots[0]?.name, '장수1');
        assert.equal(bracket.top16.slots[15]?.name, '장수16');
    });
});
