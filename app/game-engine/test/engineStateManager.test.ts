import { describe, expect, it } from 'vitest';

import { EngineStateManager } from '../src/turn/engineStateManager.js';
import { InMemoryTurnStateStore } from '../src/turn/inMemoryStateStore.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { LogCategory, LogScope } from '@sammo-ts/logic';

const buildWorld = (): InMemoryTurnWorld => {
    const baseTime = new Date('0189-01-01T00:00:00Z');
    const general: TurnGeneral = {
        id: 1,
        name: 'General_1',
        nationId: 1,
        cityId: 1,
        troopId: 0,
        stats: { leadership: 50, strength: 50, intelligence: 50 },
        turnTime: baseTime,
        role: {
            items: { horse: null, weapon: null, book: null, item: null },
            personality: null,
            specialDomestic: null,
            specialWar: null,
        },
        triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
        meta: { killturn: 24, nested: { value: 1 } },
        officerLevel: 5,
        experience: 0,
        dedication: 0,
        injury: 0,
        gold: 1000,
        rice: 1000,
        crew: 0,
        crewTypeId: 0,
        train: 0,
        atmos: 0,
        age: 30,
        npcState: 0,
    };
    const snapshot: TurnWorldSnapshot = {
        generals: [general],
        cities: [],
        nations: [],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        map: {
            id: 'test_map',
            name: 'TestMap',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        },
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: 'test_map', unitSet: 'default' },
        },
    };
    const state: TurnWorldState = {
        id: 1,
        currentYear: 189,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: baseTime,
        meta: { killturn: 24 },
    };
    return new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
};

describe('EngineStateManager', () => {
    it('commits all registered state participants as one revision', async () => {
        const manager = new EngineStateManager();
        let worldValue = 1;
        let queueValue = 10;
        manager.register('world', {
            capture: () => worldValue,
            restore: (value) => {
                worldValue = value;
            },
        });
        manager.register('queue', {
            capture: () => queueValue,
            restore: (value) => {
                queueValue = value;
            },
        });

        const result = await manager.transaction(() => {
            worldValue = 2;
            queueValue = 20;
            return 'committed';
        });

        expect(result).toBe('committed');
        expect({ worldValue, queueValue }).toEqual({ worldValue: 2, queueValue: 20 });
        expect(manager.getRevision()).toBe(1);
    });

    it('restores every participant and keeps the revision when a calculation fails', async () => {
        const manager = new EngineStateManager();
        let worldValue = { value: 1 };
        let queueValue = ['before'];
        manager.register('world', {
            capture: () => structuredClone(worldValue),
            restore: (value) => {
                worldValue = value;
            },
        });
        manager.register('queue', {
            capture: () => structuredClone(queueValue),
            restore: (value) => {
                queueValue = value;
            },
        });

        await expect(
            manager.transaction(() => {
                worldValue.value = 2;
                queueValue.push('partial');
                throw new Error('calculation failed');
            })
        ).rejects.toThrow('calculation failed');

        expect(worldValue).toEqual({ value: 1 });
        expect(queueValue).toEqual(['before']);
        expect(manager.getRevision()).toBe(0);
        expect(manager.isTransactionActive()).toBe(false);
    });

    it('restores the world entities, nested metadata, checkpoint and dirty journal', async () => {
        const world = buildWorld();
        const manager = new EngineStateManager();
        manager.register('world', {
            capture: () => world.captureState(),
            restore: (snapshot) => world.restoreState(snapshot),
            inspect: () => world.inspectState(),
        });
        const before = manager.inspect();

        await expect(
            manager.transaction(() => {
                const general = world.getGeneralById(1);
                if (!general) {
                    throw new Error('fixture general missing');
                }
                world.updateGeneral(1, {
                    gold: 25,
                    meta: { ...general.meta, nested: { value: 2 } },
                });
                world.addEvent({
                    id: 10,
                    targetCode: 'test',
                    priority: 1,
                    condition: [],
                    action: [],
                    meta: { phase: 'partial' },
                });
                world.setCheckpoint({
                    turnTime: new Date('0189-01-01T00:10:00Z').toISOString(),
                    generalId: 1,
                    year: 189,
                    month: 1,
                });
                world.pushLog({
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: 1,
                    text: 'partial',
                });
                throw new Error('handler failed');
            })
        ).rejects.toThrow('handler failed');

        expect(manager.inspect()).toEqual(before);
        expect(world.peekDirtyState().logs).toEqual([]);
        expect(world.listEvents()).toEqual([]);
    });

    it('restores the concrete state-store checkpoint when a flush transaction fails', async () => {
        const world = buildWorld();
        const stateStore = new InMemoryTurnStateStore(world);
        const previousCheckpoint = {
            turnTime: '0189-01-01T00:00:00.000Z',
            generalId: 1,
            year: 189,
            month: 1,
        };
        const nextCheckpoint = {
            turnTime: '0189-01-01T00:10:00.000Z',
            generalId: 2,
            year: 189,
            month: 1,
        };
        await stateStore.saveCheckpoint(previousCheckpoint);

        const manager = new EngineStateManager();
        manager.register('world', {
            capture: () => world.captureState(),
            restore: (snapshot) => world.restoreState(snapshot),
        });

        await expect(
            manager.transaction(async () => {
                await stateStore.saveCheckpoint(nextCheckpoint);
                throw new Error('injected flush failure');
            })
        ).rejects.toThrow('injected flush failure');

        expect(await stateStore.loadCheckpoint()).toEqual(previousCheckpoint);
        expect(world.getCheckpoint()).toEqual(previousCheckpoint);
        expect(manager.getRevision()).toBe(0);

        await manager.transaction(() => stateStore.saveCheckpoint(nextCheckpoint));
        expect(await stateStore.loadCheckpoint()).toEqual(nextCheckpoint);
        expect(world.getCheckpoint()).toEqual(nextCheckpoint);
        expect(manager.getRevision()).toBe(1);
    });

    it('creates reusable test savepoints without sharing mutable inspection data', async () => {
        const manager = new EngineStateManager();
        let state = { nested: { value: 1 } };
        manager.register('world', {
            capture: () => structuredClone(state),
            restore: (snapshot) => {
                state = snapshot;
            },
            inspect: () => state,
        });
        const baseline = manager.capture();

        await manager.transaction(() => {
            state.nested.value = 2;
        });
        const inspected = manager.inspect();
        (inspected.participants.world as typeof state).nested.value = 99;
        expect(state.nested.value).toBe(2);

        manager.restore(baseline);
        expect(state.nested.value).toBe(1);
        expect(manager.getRevision()).toBe(2);
    });

    it('rolls the reserved-turn queue and its dirty journal back with the world', async () => {
        const store = new InMemoryReservedTurnStore(
            {
                generalTurn: { findMany: async () => [] },
                nationTurn: { findMany: async () => [] },
            } as never,
            { maxGeneralTurns: 2, maxNationTurns: 1 }
        );
        store.replaceGeneralTurns(1, { action: '훈련', args: { amount: 10 } });
        const manager = new EngineStateManager();
        manager.register('reservedTurns', {
            capture: () => store.captureState(),
            restore: (snapshot) => store.restoreState(snapshot),
        });
        const before = store.captureState();

        await expect(
            manager.transaction(() => {
                store.shiftGeneralTurns(1, -1);
                store.ensureGeneralTurns(2);
                throw new Error('turn calculation failed');
            })
        ).rejects.toThrow('turn calculation failed');

        expect(store.captureState()).toEqual(before);
    });
});
