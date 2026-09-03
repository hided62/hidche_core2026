import { describe, expect, it, vi } from 'vitest';

import type { GamePrisma } from '@sammo-ts/infra';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { synchronizeRuntimeClockAuthorityUnderHeldLock } from '../src/turn/runtimeClockAuthoritySync.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const baseTime = new Date('2026-09-03T10:00:00.000Z');

const buildWorld = (phase: 'RUNNING' | 'SUSPENDED' = 'RUNNING'): InMemoryTurnWorld => {
    const general = {
        id: 1,
        name: 'clock-sync-general',
        nationId: 1,
        cityId: 1,
        troopId: 0,
        stats: { leadership: 50, strength: 50, intelligence: 50 },
        turnTime: new Date('2026-09-03T10:10:00.000Z'),
        turnTick: 36_000_000,
        role: { items: { horse: null, weapon: null, book: null, item: null } },
        triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
        meta: { killturn: 24 },
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
    } as TurnGeneral;
    const state: TurnWorldState = {
        id: 1,
        currentYear: 190,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: baseTime,
        clockBaseTime: baseTime,
        clockTick: 0,
        clockMode: 'realtime',
        clockWallAnchor: baseTime,
        lastTurnTick: 0,
        clockPhase: phase,
        clockRevision: 3,
        deadlineGeneration: 5,
        meta: { lastTurnTime: baseTime.toISOString() },
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
            id: 'clock-sync',
            name: 'clock-sync',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        },
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'default' },
        },
    };
    return new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
};

const buildDb = (worldState: Record<string, unknown>, ledgers: unknown[] = []): GamePrisma.TransactionClient =>
    ({
        worldState: { findFirst: vi.fn().mockResolvedValue(worldState) },
        clockSuspension: { findMany: vi.fn().mockResolvedValue(ledgers) },
    }) as unknown as GamePrisma.TransactionClient;

describe('runtime clock authority synchronization', () => {
    it('adopts a maintenance suspension cut without advancing the game schedule', async () => {
        const world = buildWorld('RUNNING');
        const cutWallAt = new Date('2026-09-03T10:02:00.000Z');
        const beforeTurnTick = world.getGeneralById(1)!.turnTick;
        const db = buildDb({
            id: 1,
            clockBaseTime: baseTime,
            clockTick: 7_200_000n,
            clockMode: 'realtime',
            clockWallAnchor: cutWallAt,
            lastTurnTick: 0n,
            clockPhase: 'SUSPENDED',
            clockRevision: 3n,
            deadlineGeneration: 5n,
        });

        await expect(synchronizeRuntimeClockAuthorityUnderHeldLock(db, world)).resolves.toBe(true);

        expect(world.getGameClockState()).toMatchObject({
            phase: 'SUSPENDED',
            tick: 7_200_000,
            revision: 3,
            deadlineGeneration: 5,
            wallAnchor: cutWallAt,
        });
        expect(world.getGeneralById(1)!.turnTick).toBe(beforeTurnTick);
    });

    it('replays the durable reconciliation shift before returning to RUNNING', async () => {
        const world = buildWorld('SUSPENDED');
        const resumeWallAt = new Date('2026-09-03T11:00:00.000Z');
        const shiftTicks = 5_000;
        const beforeTurnTick = world.getGeneralById(1)!.turnTick!;
        const db = buildDb(
            {
                id: 1,
                clockBaseTime: baseTime,
                clockTick: 5_000n,
                clockMode: 'realtime',
                clockWallAnchor: resumeWallAt,
                lastTurnTick: 5_000n,
                clockPhase: 'RUNNING',
                clockRevision: 4n,
                deadlineGeneration: 6n,
            },
            [
                {
                    id: 'maintenance-revision-3',
                    sourceRevision: 3n,
                    targetRevision: 4n,
                    shiftTicks: BigInt(shiftTicks),
                    alignedTick: 5_000n,
                    resumeWallAt,
                },
            ]
        );

        await expect(synchronizeRuntimeClockAuthorityUnderHeldLock(db, world)).resolves.toBe(true);

        expect(world.getGameClockState()).toMatchObject({
            phase: 'RUNNING',
            tick: 5_000,
            lastTurnTick: 5_000,
            revision: 4,
            deadlineGeneration: 6,
            wallAnchor: resumeWallAt,
        });
        expect(world.getGeneralById(1)!.turnTick).toBe(beforeTurnTick + shiftTicks);
    });

    it('rejects a revision jump when the durable ledger chain is incomplete', async () => {
        const world = buildWorld('SUSPENDED');
        const db = buildDb({
            id: 1,
            clockBaseTime: baseTime,
            clockTick: 1n,
            clockMode: 'realtime',
            clockWallAnchor: baseTime,
            lastTurnTick: 1n,
            clockPhase: 'RUNNING',
            clockRevision: 4n,
            deadlineGeneration: 6n,
        });

        await expect(synchronizeRuntimeClockAuthorityUnderHeldLock(db, world)).rejects.toThrow(
            /ledger chain ended at 3\/5/
        );
    });
});
