import { describe, expect, it } from 'vitest';

import { DEFAULT_WAR_TERM, DIPLOMACY_STATE, processDiplomacyMonth, type DiplomacyEntry } from '@sammo-ts/logic';

const buildEntry = (
    fromNationId: number,
    toNationId: number,
    state: number,
    term: number,
    dead = 0
): DiplomacyEntry => ({
    fromNationId,
    toNationId,
    state,
    term,
    dead,
    meta: {},
});

describe('diplomacy month processing', () => {
    it('promotes declaration to war after term expires', () => {
        const entries = [
            buildEntry(1, 2, DIPLOMACY_STATE.DECLARATION, 1),
            buildEntry(2, 1, DIPLOMACY_STATE.DECLARATION, 1),
        ];
        const result = processDiplomacyMonth(
            entries,
            new Map([
                [1, 1],
                [2, 1],
            ])
        );

        for (const entry of result) {
            expect(entry.state).toBe(DIPLOMACY_STATE.WAR);
            expect(entry.term).toBe(DEFAULT_WAR_TERM);
        }
    });

    it('ends war when both terms reach zero without casualties', () => {
        const entries = [buildEntry(1, 2, DIPLOMACY_STATE.WAR, 1), buildEntry(2, 1, DIPLOMACY_STATE.WAR, 1)];
        const result = processDiplomacyMonth(
            entries,
            new Map([
                [1, 1],
                [2, 1],
            ])
        );

        for (const entry of result) {
            expect(entry.state).toBe(DIPLOMACY_STATE.TRADE);
            expect(entry.term).toBe(0);
        }
    });

    it('extends war term based on accumulated casualties', () => {
        const entries = [buildEntry(1, 2, DIPLOMACY_STATE.WAR, 3, 400), buildEntry(2, 1, DIPLOMACY_STATE.WAR, 3, 0)];
        const result = processDiplomacyMonth(
            entries,
            new Map([
                [1, 2],
                [2, 2],
            ])
        );

        const forward = result.find((entry) => entry.fromNationId === 1 && entry.toNationId === 2);
        const reverse = result.find((entry) => entry.fromNationId === 2 && entry.toNationId === 1);
        expect(forward?.term).toBe(4);
        expect(forward?.dead).toBe(0);
        expect(reverse?.term).toBe(2);
    });

    it('expires non-aggression pact into trade', () => {
        const entries = [
            buildEntry(1, 2, DIPLOMACY_STATE.NON_AGGRESSION, 1),
            buildEntry(2, 1, DIPLOMACY_STATE.NON_AGGRESSION, 1),
        ];
        const result = processDiplomacyMonth(
            entries,
            new Map([
                [1, 1],
                [2, 1],
            ])
        );

        for (const entry of result) {
            expect(entry.state).toBe(DIPLOMACY_STATE.TRADE);
            expect(entry.term).toBe(0);
        }
    });
});
