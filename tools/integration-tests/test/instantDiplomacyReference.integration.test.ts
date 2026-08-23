import { describe, expect, it } from 'vitest';

import {
    findTurnDifferentialWorkspaceRoot,
    runReferenceTurnCommandTraceRequest,
} from '../src/turn-differential/referenceSnapshot.js';

const configuredWorkspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT;
const workspaceRoot = configuredWorkspaceRoot ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const integration = describe.skipIf(!workspaceRoot || process.env.TURN_DIFFERENTIAL_REFERENCE !== '1');

const baseSetup = (state: number, term: number) => ({
    isolateWorld: true,
    world: { year: 190, month: 3 },
    nations: [
        { id: 1, name: '수락국', capitalCityId: 1 },
        { id: 2, name: '제안국', capitalCityId: 2 },
    ],
    cities: [
        { id: 1, nationId: 1, supplyState: 1, frontState: 1 },
        { id: 2, nationId: 2, supplyState: 1, frontState: 1 },
    ],
    generals: [
        { id: 1, name: '수락장수', nationId: 1, cityId: 1, officerLevel: 5 },
        { id: 2, name: '제안장수', nationId: 2, cityId: 2, officerLevel: 5 },
    ],
    diplomacy: [
        { fromNationId: 1, toNationId: 2, state, term },
        { fromNationId: 2, toNationId: 1, state, term },
    ],
});

const observe = {
    generalIds: [1, 2],
    nationIds: [1, 2],
    cityIds: [1, 2],
    logAfterId: 0,
    messageAfterId: 0,
};

const addedLogs = (trace: ReturnType<typeof runReferenceTurnCommandTraceRequest>) =>
    trace.after.logs.filter((log) => Number(log.id) > trace.before.watermarks.logId);

// This suite intentionally records the Ref command behavior only. The dynamic
// Core-vs-Ref product-path comparison lives in
// instantDiplomacyCoreReference.integration.test.ts.
integration('legacy instant diplomacy command behavior (Ref-only)', () => {
    it('accepts non-aggression without RNG and copies received assistance', () => {
        const setup = baseSetup(2, 0);
        setup.nations[1] = {
            ...setup.nations[1],
            nationEnv: { recv_assist: { n1: [1, 37] } },
        } as (typeof setup.nations)[number];
        const trace = runReferenceTurnCommandTraceRequest(workspaceRoot!, {
            kind: 'instantNation',
            actorGeneralId: 1,
            action: 'che_불가침수락',
            args: { destNationID: 2, destGeneralID: 2, year: 191, month: 2 },
            setup,
            observe,
        });

        expect(trace.execution).toMatchObject({
            kind: 'instantNation',
            action: 'che_불가침수락',
            seedDomain: 'none',
        });
        expect(trace.rng).toEqual([]);
        expect(trace.after.diplomacy).toEqual([
            expect.objectContaining({ fromNationId: 1, toNationId: 2, state: 7, term: 12 }),
            expect.objectContaining({ fromNationId: 2, toNationId: 1, state: 7, term: 12 }),
        ]);
        expect(trace.after.nations[1]).toMatchObject({
            meta: {
                recv_assist: { n1: [1, 37] },
                resp_assist: { n1: [1, 37] },
            },
        });
        expect(addedLogs(trace).map((log) => [log.generalId, log.category])).toEqual([
            [1, 'history'],
            [1, 'action'],
            [2, 'history'],
            [2, 'action'],
        ]);
    });

    it('accepts non-aggression cancellation with legacy grouped log order', () => {
        const trace = runReferenceTurnCommandTraceRequest(workspaceRoot!, {
            kind: 'instantNation',
            actorGeneralId: 1,
            action: 'che_불가침파기수락',
            args: { destNationID: 2, destGeneralID: 2 },
            setup: baseSetup(7, 12),
            observe,
        });

        expect(trace.rng).toEqual([]);
        expect(trace.after.diplomacy).toEqual([
            expect.objectContaining({ fromNationId: 1, toNationId: 2, state: 2, term: 0 }),
            expect.objectContaining({ fromNationId: 2, toNationId: 1, state: 2, term: 0 }),
        ]);
        expect(addedLogs(trace).map((log) => [log.generalId, log.category])).toEqual([
            [1, 'history'],
            [1, 'action'],
            [0, 'summary'],
            [2, 'history'],
            [2, 'action'],
        ]);
        expect(addedLogs(trace)[2]?.text).toContain('수락장수');
    });

    it('accepts stop-war and recalculates both nations fronts', () => {
        const setup = baseSetup(0, 6);
        setup.diplomacy[1] = { fromNationId: 2, toNationId: 1, state: 1, term: 6 };
        const trace = runReferenceTurnCommandTraceRequest(workspaceRoot!, {
            kind: 'instantNation',
            actorGeneralId: 1,
            action: 'che_종전수락',
            args: { destNationID: 2, destGeneralID: 2 },
            setup,
            observe,
        });

        expect(trace.rng).toEqual([]);
        expect(trace.after.diplomacy).toEqual([
            expect.objectContaining({ fromNationId: 1, toNationId: 2, state: 2, term: 0 }),
            expect.objectContaining({ fromNationId: 2, toNationId: 1, state: 2, term: 0 }),
        ]);
        expect(trace.after.cities).toEqual([
            expect.objectContaining({ id: 1, frontState: 2 }),
            expect.objectContaining({ id: 2, frontState: 2 }),
        ]);
        expect(addedLogs(trace).map((log) => [log.generalId, log.category])).toEqual([
            [1, 'history'],
            [1, 'action'],
            [0, 'summary'],
            [2, 'history'],
            [2, 'action'],
        ]);
    });
});
