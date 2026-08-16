import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyRealtimeReadModelChanges, createEmptyRealtimeReadModelInvalidation } from '@sammo-ts/common';
import {
    createMergedReadModelRefreshQueue,
    resolveDashboardContextBundleInclude,
    resolveDashboardRefreshPlan,
} from '../src/utils/dashboardReadModel.ts';

void test('last-turn-time-only events do not schedule any dashboard query', () => {
    const plan = resolveDashboardRefreshPlan(createEmptyRealtimeReadModelChanges(), {
        generalId: 7,
        cityId: 3,
        nationId: 2,
    });

    assert.deepEqual(plan, {
        context: false,
        lobby: false,
        map: false,
        commands: false,
        contacts: false,
        boardAccess: false,
        reservedTurns: false,
        records: false,
        frontStatus: false,
    });
});

void test('selects only the read models affected by the current identity', () => {
    const changes = {
        ...createEmptyRealtimeReadModelChanges(),
        generalIds: [7, 99],
        reservedGeneralIds: [7],
        recordGeneralIds: [7],
    };

    assert.deepEqual(resolveDashboardRefreshPlan(changes, { generalId: 7, cityId: 3, nationId: 2 }), {
        context: true,
        lobby: false,
        map: false,
        commands: true,
        contacts: false,
        boardAccess: true,
        reservedTurns: true,
        records: true,
        frontStatus: false,
    });
});

void test('refreshes the map only for map-projection changes', () => {
    const changes = {
        ...createEmptyRealtimeReadModelChanges(),
        generalIds: [7],
        mapGeneralIds: [7],
    };

    assert.equal(resolveDashboardRefreshPlan(changes, { generalId: 7, cityId: 3, nationId: 2 }).map, true);
});

void test('routes defence, tax-rate, and current-city-state events to their exact dashboard slices', () => {
    const identity = { generalId: 7, cityId: 3, nationId: 2 };
    const defence = resolveDashboardRefreshPlan(
        {
            ...createEmptyRealtimeReadModelChanges(),
            cityIds: [3],
            mapCityIds: [],
        },
        identity
    );
    assert.deepEqual(defence, {
        context: true,
        lobby: false,
        map: false,
        commands: true,
        contacts: false,
        boardAccess: false,
        reservedTurns: false,
        records: false,
        frontStatus: false,
    });

    const taxRate = resolveDashboardRefreshPlan(
        {
            ...createEmptyRealtimeReadModelChanges(),
            nationIds: [2],
            mapNationIds: [],
            frontStatusNationIds: [],
        },
        identity
    );
    assert.deepEqual(taxRate, {
        context: true,
        lobby: false,
        map: false,
        commands: true,
        contacts: false,
        boardAccess: true,
        reservedTurns: false,
        records: false,
        frontStatus: false,
    });

    const cityState = resolveDashboardRefreshPlan(
        {
            ...createEmptyRealtimeReadModelChanges(),
            cityIds: [3],
            mapCityIds: [3],
        },
        identity
    );
    assert.equal(cityState.context, true);
    assert.equal(cityState.commands, true);
    assert.equal(cityState.map, true);
});

void test('keeps conservative map behavior for rolling-deploy payloads without projections', () => {
    const changes = {
        generalIds: [7],
        cityIds: [],
        nationIds: [],
        reservedGeneralIds: [],
        recordGeneralIds: [],
        worldChanged: false,
        globalRecordsChanged: false,
        worldHistoryChanged: false,
        contactsChanged: false,
    };

    assert.equal(resolveDashboardRefreshPlan(changes, { generalId: 7, cityId: 3, nationId: 2 }).map, true);
});

void test('does not refresh front status for contact-only permission changes', () => {
    const changes = {
        ...createEmptyRealtimeReadModelChanges(),
        generalIds: [9],
        contactsChanged: true,
        frontStatusGeneralIds: [],
    };
    const plan = resolveDashboardRefreshPlan(changes, { generalId: 7, cityId: 3, nationId: 2 });

    assert.equal(plan.contacts, true);
    assert.equal(plan.lobby, false);
    assert.equal(plan.frontStatus, false);
});

void test('refreshes only front status for a global survey projection change', () => {
    const changes = {
        ...createEmptyRealtimeReadModelChanges(),
        frontStatusChanged: true,
    };

    assert.deepEqual(resolveDashboardRefreshPlan(changes, { generalId: 7, cityId: 3, nationId: 2 }), {
        context: false,
        lobby: false,
        map: false,
        commands: false,
        contacts: false,
        boardAccess: false,
        reservedTurns: false,
        records: false,
        frontStatus: true,
    });
});

void test('targets a submitted survey projection to its own general', () => {
    const changes = {
        ...createEmptyRealtimeReadModelChanges(),
        frontStatusActorIds: [7],
    };

    assert.equal(resolveDashboardRefreshPlan(changes, { generalId: 7, cityId: 3, nationId: 2 }).frontStatus, true);
    assert.equal(resolveDashboardRefreshPlan(changes, { generalId: 8, cityId: 3, nationId: 2 }).frontStatus, false);
});

void test('keeps the access bundle projection-free for map, records, and front-status-only plans', () => {
    for (const slice of ['map', 'records', 'frontStatus'] as const) {
        const plan = { ...createEmptyRealtimeReadModelInvalidation(), [slice]: true };
        assert.deepEqual(resolveDashboardContextBundleInclude(plan), {
            context: false,
            commandTable: false,
            boardAccess: false,
        });
    }
});

void test('selects only the requested context bundle projections', () => {
    const plan = {
        ...createEmptyRealtimeReadModelInvalidation(),
        context: true,
        commands: true,
    };
    assert.deepEqual(resolveDashboardContextBundleInclude(plan), {
        context: true,
        commandTable: true,
        boardAccess: false,
    });
});

void test('merges browser-safe boolean invalidations and starts at most once per interval', async () => {
    let nowMs = 0;
    let nextTimerId = 1;
    const timers = new Map<number, { callback: () => void; at: number }>();
    const observed: Array<{ context: boolean; records: boolean }> = [];
    const queue = createMergedReadModelRefreshQueue(
        async (invalidation) => {
            observed.push({ context: invalidation.context, records: invalidation.records });
        },
        {
            minIntervalMs: 1_000,
            now: () => nowMs,
            setTimer: (callback, delayMs) => {
                const id = nextTimerId++;
                timers.set(id, { callback, at: nowMs + delayMs });
                return id as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimer: (timer) => timers.delete(timer as unknown as number),
        }
    );
    const runDueTimers = () => {
        for (const [id, timer] of [...timers]) {
            if (timer.at <= nowMs) {
                timers.delete(id);
                timer.callback();
            }
        }
    };

    queue.request({ ...createEmptyRealtimeReadModelInvalidation(), context: true });
    runDueTimers();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(observed, [{ context: true, records: false }]);

    queue.request({ ...createEmptyRealtimeReadModelInvalidation(), context: true });
    queue.request({ ...createEmptyRealtimeReadModelInvalidation(), records: true });
    nowMs = 999;
    runDueTimers();
    assert.equal(observed.length, 1);
    nowMs = 1_000;
    runDueTimers();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(observed, [
        { context: true, records: false },
        { context: true, records: true },
    ]);
});
