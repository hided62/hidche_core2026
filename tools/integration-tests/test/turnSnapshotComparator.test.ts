import { describe, expect, it } from 'vitest';

import { canonicalizeTurnCommandArgs, type CanonicalTurnSnapshot } from '../src/turn-differential/canonical.js';
import {
    buildTurnSnapshotDelta,
    compareTurnSnapshotDeltas,
    compareTurnSnapshots,
} from '../src/turn-differential/compare.js';
import {
    projectRefFloatRead,
    projectSnapshotThroughRefFloatRead,
} from '../src/turn-differential/legacyNumericProjection.js';

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
    troops: [],
    diplomacy: [],
    generalTurns: [{ generalId: 1, turnIndex: 0, action: 'che_농지개간', args: null }],
    nationTurns: [],
    logs: [],
    messages: [],
    watermarks: { logId: 0, historyLogId: 0, messageId: 0 },
    ...overrides,
});

describe('turn snapshot differential comparator', () => {
    it('projects only explicitly selected Core numeric state through the Ref FLOAT boundary', () => {
        expect(projectRefFloatRead(1_000.0048)).toBe(1_000);
        expect(projectRefFloatRead(1_000.009)).toBe(1_000.01);
        expect(projectRefFloatRead(70.10659591920879)).toBe(70.1066);

        const core = snapshot('core2026', {
            cities: [{ id: 1, trust: 70.10659591920879, agriculture: 123.456789 }],
            nations: [{ id: 1, tech: 1_000.009, gold: 123.456789 }],
        });
        const projected = projectSnapshotThroughRefFloatRead(core, { cityTrust: true, nationTech: true });

        expect(projected.cities[0]).toEqual({ id: 1, trust: 70.1066, agriculture: 123.456789 });
        expect(projected.nations[0]).toEqual({ id: 1, tech: 1_000.01, gold: 123.456789 });
        expect(core.cities[0]?.trust).toBe(70.10659591920879);
        expect(core.nations[0]?.tech).toBe(1_000.009);
    });

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

    it('distinguishes a present empty collection from a missing property', () => {
        const reference = snapshot('ref', {
            world: {
                year: 183,
                month: 1,
                tickMinutes: 10,
                turnTime: '0183-01-01T00:00:00.000Z',
                isUnited: 0,
                nationCooldowns: [],
                generalFlags: {},
            },
        });
        const core = snapshot('core2026');

        const differences = compareTurnSnapshots(reference, core);
        expect(differences).toContainEqual({
            path: 'world.nationCooldowns',
            reference: { $snapshotState: 'array' },
            core: { $snapshotState: 'missing' },
        });
        expect(differences).toContainEqual({
            path: 'world.generalFlags',
            reference: { $snapshotState: 'object' },
            core: { $snapshotState: 'missing' },
        });
        expect(
            compareTurnSnapshots(reference, core, {
                ignoredPathPatterns: [/^world\.(?:nationCooldowns|generalFlags)(?:\.|$)/],
            })
        ).toEqual([]);
    });

    it('distinguishes an empty JSON object from an empty JSON array', () => {
        const reference = snapshot('ref', {
            generals: [{ id: 1, gold: 1000, rice: 1000, crew: 1000, nationId: 1, cityId: 1, meta: {} }],
        });
        const core = snapshot('core2026', {
            generals: [{ id: 1, gold: 1000, rice: 1000, crew: 1000, nationId: 1, cityId: 1, meta: [] }],
        });

        expect(compareTurnSnapshots(reference, core)).toContainEqual({
            path: 'generals[1].meta',
            reference: { $snapshotState: 'object' },
            core: { $snapshotState: 'array' },
        });
    });

    it('distinguishes collection deletion from replacement with an empty collection in deltas', () => {
        const beforeRef = snapshot('ref', {
            world: {
                year: 183,
                month: 1,
                tickMinutes: 10,
                turnTime: '0183-01-01T00:00:00.000Z',
                isUnited: 0,
                nationCooldowns: [{ nationId: 1, remaining: 2 }],
            },
        });
        const afterRef = snapshot('ref');
        const beforeCore = snapshot('core2026', {
            world: {
                year: 183,
                month: 1,
                tickMinutes: 10,
                turnTime: '0183-01-01T00:00:00.000Z',
                isUnited: 0,
                nationCooldowns: [{ nationId: 1, remaining: 2 }],
            },
        });
        const afterCore = snapshot('core2026', {
            world: {
                year: 183,
                month: 1,
                tickMinutes: 10,
                turnTime: '0183-01-01T00:00:00.000Z',
                isUnited: 0,
                nationCooldowns: [],
            },
        });

        expect(compareTurnSnapshotDeltas(beforeRef, afterRef, beforeCore, afterCore)).toContainEqual({
            path: 'world.nationCooldowns',
            reference: {
                before: { $snapshotState: 'array' },
                after: { $snapshotState: 'missing' },
            },
            core: { $snapshotState: 'missing' },
        });
    });

    it('fails closed when an entity array repeats a semantic key', () => {
        const reference = snapshot('ref', {
            cities: [
                { id: 1, nationId: 1, agriculture: 900 },
                { id: 1, nationId: 1, agriculture: 1000 },
            ],
        });
        const core = snapshot('core2026', {
            cities: [{ id: 1, nationId: 1, agriculture: 1000 }],
        });

        const expectedError = 'Duplicate semantic entity key "1" at "cities": indexes 0 and 1';
        expect(() => compareTurnSnapshots(reference, core)).toThrowError(expectedError);
        expect(() => compareTurnSnapshotDeltas(snapshot('ref'), reference, snapshot('core2026'), core)).toThrowError(
            expectedError
        );
    });

    it('keys multiple cooldowns for one owner by owner and action name', () => {
        const referenceBefore = snapshot('ref', {
            world: {
                year: 183,
                month: 1,
                tickMinutes: 10,
                turnTime: '0183-01-01T00:00:00.000Z',
                isUnited: 0,
                generalCooldowns: [
                    { generalId: 1, actionName: '일반 행동', nextAvailableTurn: 0 },
                    { generalId: 1, actionName: '특수 행동', nextAvailableTurn: 0 },
                ],
                nationCooldowns: [
                    { nationId: 1, actionName: '피장파장', nextAvailableTurn: 0 },
                    { nationId: 1, actionName: '이호경식', nextAvailableTurn: 0 },
                ],
            },
        });
        const coreBefore = snapshot('core2026', {
            world: {
                year: 183,
                month: 1,
                tickMinutes: 10,
                turnTime: '0183-01-01T00:00:00.000Z',
                isUnited: 0,
                generalCooldowns: [
                    { generalId: 1, actionName: '특수 행동', nextAvailableTurn: 0 },
                    { generalId: 1, actionName: '일반 행동', nextAvailableTurn: 0 },
                ],
                nationCooldowns: [
                    { nationId: 1, actionName: '이호경식', nextAvailableTurn: 0 },
                    { nationId: 1, actionName: '피장파장', nextAvailableTurn: 0 },
                ],
            },
        });
        const reference = snapshot('ref', {
            world: {
                year: 183,
                month: 1,
                tickMinutes: 10,
                turnTime: '0183-01-01T00:00:00.000Z',
                isUnited: 0,
                generalCooldowns: [
                    { generalId: 1, actionName: '일반 행동', nextAvailableTurn: 3 },
                    { generalId: 1, actionName: '특수 행동', nextAvailableTurn: 7 },
                ],
                nationCooldowns: [
                    { nationId: 1, actionName: '피장파장', nextAvailableTurn: 9 },
                    { nationId: 1, actionName: '이호경식', nextAvailableTurn: 11 },
                ],
            },
        });
        const core = snapshot('core2026', {
            world: {
                year: 183,
                month: 1,
                tickMinutes: 10,
                turnTime: '0183-01-01T00:00:00.000Z',
                isUnited: 0,
                generalCooldowns: [
                    { generalId: 1, actionName: '특수 행동', nextAvailableTurn: 7 },
                    { generalId: 1, actionName: '일반 행동', nextAvailableTurn: 3 },
                ],
                nationCooldowns: [
                    { nationId: 1, actionName: '이호경식', nextAvailableTurn: 11 },
                    { nationId: 1, actionName: '피장파장', nextAvailableTurn: 9 },
                ],
            },
        });

        expect(compareTurnSnapshots(reference, core)).toEqual([]);
        expect(compareTurnSnapshotDeltas(referenceBefore, reference, coreBefore, core)).toEqual([]);

        const mutant = snapshot('core2026', {
            ...core,
            world: {
                ...core.world,
                nationCooldowns: [
                    { nationId: 1, actionName: '이호경식', nextAvailableTurn: 11 },
                    { nationId: 1, actionName: '피장파장', nextAvailableTurn: 10 },
                ],
            },
        });
        expect(compareTurnSnapshots(reference, mutant)).toContainEqual({
            path: 'world.nationCooldowns[1:피장파장].nextAvailableTurn',
            reference: 9,
            core: 10,
        });
        expect(compareTurnSnapshotDeltas(referenceBefore, reference, coreBefore, mutant)).toEqual([
            {
                path: 'world.nationCooldowns[1:피장파장].nextAvailableTurn',
                reference: 9,
                core: 10,
            },
        ]);

        const duplicate = snapshot('ref', {
            world: {
                ...reference.world,
                nationCooldowns: [
                    { nationId: 1, actionName: '피장파장', nextAvailableTurn: 9 },
                    { nationId: 1, actionName: '피장파장', nextAvailableTurn: 10 },
                ],
            },
        });
        expect(() => compareTurnSnapshots(duplicate, core)).toThrowError(
            'Duplicate semantic entity key "1:피장파장" at "world.nationCooldowns": indexes 0 and 1'
        );
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
            reference: { before: 0, after: { $snapshotState: 'missing' } },
            core: { $snapshotState: 'missing' },
        });
    });
});
