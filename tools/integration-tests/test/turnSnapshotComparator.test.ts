import { describe, expect, it } from 'vitest';

import { canonicalizeTurnCommandArgs, type CanonicalTurnSnapshot } from '../src/turn-differential/canonical.js';
import {
    buildTurnSnapshotDelta,
    compareTurnSnapshotDeltas,
    compareTurnSnapshots,
} from '../src/turn-differential/compare.js';

const snapshot = (
    engine: 'ref' | 'core2026',
    overrides: Partial<CanonicalTurnSnapshot> = {}
): CanonicalTurnSnapshot => ({
    schemaVersion: 1,
    engine,
    world: { year: 183, month: 1, tickMinutes: 10, turnTime: '0183-01-01T00:00:00.000Z', isUnited: 0 },
    generals: [{ id: 1, gold: 1000, rice: 1000, crew: 1000, nationId: 1, cityId: 1 }],
    rankData: [],
    cities: [{ id: 1, nationId: 1, agriculture: 1000, defence: 500 }],
    nations: [{ id: 1, gold: 0, rice: 0 }],
    diplomacy: [],
    generalTurns: [{ generalId: 1, turnIndex: 0, action: 'che_농지개간', args: null }],
    nationTurns: [],
    logs: [],
    messages: [],
    watermarks: { logId: 0, historyLogId: 0, messageId: 0 },
    ...overrides,
});

describe('turn snapshot differential comparator', () => {
    it('compares entity arrays by semantic identity instead of database row order', () => {
        const reference = snapshot('ref', {
            cities: [
                { id: 2, nationId: 2, agriculture: 900 },
                { id: 1, nationId: 1, agriculture: 1000 },
            ],
        });
        const core = snapshot('core2026', {
            cities: [
                { id: 1, nationId: 1, agriculture: 1000 },
                { id: 2, nationId: 2, agriculture: 900 },
            ],
        });

        expect(compareTurnSnapshots(reference, core)).toEqual([]);
    });

    it('compares rank rows by general and type instead of array position', () => {
        const reference = snapshot('ref', {
            rankData: [
                { generalId: 2, nationId: 1, type: 'firenum', value: 3 },
                { generalId: 1, nationId: 1, type: 'warnum', value: 5 },
            ],
        });
        const core = snapshot('core2026', {
            rankData: [
                { generalId: 1, nationId: 1, type: 'warnum', value: 5 },
                { generalId: 2, nationId: 1, type: 'firenum', value: 3 },
            ],
        });

        expect(compareTurnSnapshots(reference, core)).toEqual([]);
    });

    it('normalizes legacy ID argument spelling at the trace boundary', () => {
        expect(
            canonicalizeTurnCommandArgs({
                destCityID: 70,
                nested: [{ destNationID: 2 }],
            })
        ).toEqual({
            destCityId: 70,
            nested: [{ destNationId: 2 }],
        });
    });

    it('compares ordered log content independently from database primary keys', () => {
        const reference = snapshot('ref', {
            logs: [{ id: 10, category: 'action', text: '동일 로그' }],
        });
        const core = snapshot('core2026', {
            logs: [{ id: 900, category: 'action', text: '동일 로그' }],
        });

        expect(
            compareTurnSnapshots(reference, core, {
                ignoredPathPatterns: [/^logs\[[^\]]+\]\.id$/],
            })
        ).toEqual([]);
    });

    it('reports exact changed paths for general and nation command state', () => {
        const reference = snapshot('ref', {
            diplomacy: [{ fromNationId: 1, toNationId: 2, state: 1, term: 24 }],
        });
        const core = snapshot('core2026', {
            diplomacy: [{ fromNationId: 1, toNationId: 2, state: 1, term: 23 }],
        });

        expect(compareTurnSnapshots(reference, core)).toEqual([
            {
                path: 'diplomacy[1->2].term',
                reference: 24,
                core: 23,
            },
        ]);
    });

    it('compares before/after deltas when database layouts or initial values differ', () => {
        const refBefore = snapshot('ref');
        const refAfter = snapshot('ref', {
            generals: [{ id: 1, gold: 990, rice: 1000, crew: 1000, nationId: 1, cityId: 1 }],
            cities: [{ id: 1, nationId: 1, agriculture: 1042, defence: 500 }],
        });
        const coreBefore = snapshot('core2026', {
            generals: [{ id: 1, gold: 2000, rice: 1000, crew: 1000, nationId: 1, cityId: 1 }],
            cities: [{ id: 1, nationId: 1, agriculture: 3000, defence: 500 }],
        });
        const coreAfter = snapshot('core2026', {
            generals: [{ id: 1, gold: 1990, rice: 1000, crew: 1000, nationId: 1, cityId: 1 }],
            cities: [{ id: 1, nationId: 1, agriculture: 3042, defence: 500 }],
        });

        expect(buildTurnSnapshotDelta(refBefore, refAfter).get('cities[1].agriculture')).toBe(42);
        expect(compareTurnSnapshotDeltas(refBefore, refAfter, coreBefore, coreAfter)).toEqual([]);
    });

    it('detects live sortie persistence differences including conquest and nation collapse', () => {
        const beforeRef = snapshot('ref', {
            cities: [{ id: 2, nationId: 2, agriculture: 1000, defence: 1 }],
            nations: [
                { id: 1, gold: 0, rice: 0 },
                { id: 2, gold: 0, rice: 0 },
            ],
        });
        const afterRef = snapshot('ref', {
            cities: [{ id: 2, nationId: 1, agriculture: 1000, defence: 0 }],
            nations: [{ id: 1, gold: 0, rice: 0 }],
        });
        const beforeCore = snapshot('core2026', {
            cities: [{ id: 2, nationId: 2, agriculture: 1000, defence: 1 }],
            nations: [
                { id: 1, gold: 0, rice: 0 },
                { id: 2, gold: 0, rice: 0 },
            ],
        });
        const afterCore = snapshot('core2026', {
            cities: [{ id: 2, nationId: 1, agriculture: 1000, defence: 0 }],
            nations: [
                { id: 1, gold: 0, rice: 0 },
                { id: 2, gold: 0, rice: 0 },
            ],
        });

        expect(compareTurnSnapshotDeltas(beforeRef, afterRef, beforeCore, afterCore)).toContainEqual({
            path: 'nations[2].gold',
            reference: { before: 0, after: undefined },
            core: undefined,
        });
    });
});
