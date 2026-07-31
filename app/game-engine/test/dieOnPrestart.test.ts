import { describe, expect, it, vi } from 'vitest';

import type { GamePrisma } from '@sammo-ts/infra';
import type { TurnSchedule } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { buildPrestartDeleteAfter, formatPrestartDeleteAfter } from '../src/turn/prestartDeletion.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';

const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
const acceptedAt = new Date('2026-07-31T00:00:00.000Z');

const buildGeneral = (overrides: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id: 7,
    userId: 'owner-7',
    name: '테스트장수',
    nationId: 0,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 60, intelligence: 50 },
    turnTime: new Date('0185-01-01T00:00:00.000Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    penalty: {},
    officerLevel: 0,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 20,
    npcState: 0,
    ...overrides,
    meta: { killturn: 6, ...overrides.meta },
});

const buildFixture = (options: {
    generals?: TurnGeneral[];
    minTurns?: number;
    lastTurnTime?: Date;
    troops?: TurnWorldSnapshot['troops'];
    lastRefresh?: Date | null;
    eventActor?: string;
}) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 185,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: options.lastTurnTime ?? new Date('2026-07-30T00:00:00.000Z'),
        meta: { opentime: '2026-08-01T00:00:00.000Z' },
    };
    const snapshot: TurnWorldSnapshot = {
        generals: options.generals ?? [buildGeneral()],
        cities: [],
        nations: [],
        troops: options.troops ?? [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 65 },
            iconPath: '',
            map: {},
            const: {
                ...(options.minTurns === undefined ? {} : { minTurnDieOnPrestart: options.minTurns }),
            },
            environment: { mapName: 'test', unitSet: 'test' },
        },
        scenarioMeta: {
            title: 'test',
            startYear: 180,
            life: null,
            fiction: null,
            history: [],
            ignoreDefaultEvents: false,
        },
        map: {
            id: 'test',
            name: 'test',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        },
    };
    const world = new InMemoryTurnWorld(state, snapshot, { schedule });
    const inputEvent = {
        findUnique: vi.fn(async ({ where }: { where: { requestId: string } }) => ({
            createdAt: acceptedAt,
            actorUserId: options.eventActor ?? 'owner-7',
            target: 'ENGINE',
            eventType: where.requestId.startsWith('status-') ? 'ensureDieOnPrestartStatus' : 'dieOnPrestart',
        })),
    };
    const generalAccessLog = {
        findUnique: vi.fn(async () =>
            options.lastRefresh === null ? null : { lastRefresh: options.lastRefresh ?? acceptedAt }
        ),
    };
    const db = { inputEvent, generalAccessLog } as unknown as GamePrisma.TransactionClient;
    return {
        world,
        db,
        handler: createTurnDaemonCommandHandler({ world }),
        inputEvent,
        generalAccessLog,
    };
};

describe('pre-start general deletion', () => {
    it('uses the default two turns, scenario override, and Ref Seoul error timestamp', () => {
        expect(buildPrestartDeleteAfter(acceptedAt, 600, { const: {} }).toISOString()).toBe('2026-07-31T00:20:00.000Z');
        expect(
            buildPrestartDeleteAfter(acceptedAt, 600, {
                const: { minTurnDieOnPrestart: 1 },
            }).toISOString()
        ).toBe('2026-07-31T00:10:00.000Z');
        expect(formatPrestartDeleteAfter(new Date('2026-07-31T00:20:00.000Z'))).toBe('2026-07-31 09:20:00');
    });

    it('fixes a legacy missing cutoff once from lastRefresh and returns it on later status requests', async () => {
        const lastRefresh = new Date('2026-07-30T23:55:00.000Z');
        const fixture = buildFixture({ lastRefresh });
        const first = await fixture.handler.handle(
            {
                type: 'ensureDieOnPrestartStatus',
                requestId: 'status-first',
                userId: 'owner-7',
                generalId: 7,
            },
            { db: fixture.db }
        );
        expect(first).toEqual({
            type: 'ensureDieOnPrestartStatus',
            generalId: 7,
            show: true,
            available: false,
            availableAt: '2026-07-31T00:15:00.000Z',
        });
        expect(fixture.world.getGeneralById(7)?.meta.prestart_delete_after).toBe('2026-07-31T00:15:00.000Z');

        const second = await fixture.handler.handle(
            {
                type: 'ensureDieOnPrestartStatus',
                requestId: 'status-second',
                userId: 'owner-7',
                generalId: 7,
            },
            { db: fixture.db }
        );
        expect(second).toEqual(first);
        expect(fixture.generalAccessLog.findUnique).toHaveBeenCalledTimes(1);
    });

    it('preserves the Ref error order and validates the durable event actor', async () => {
        const started = buildFixture({
            generals: [buildGeneral({ nationId: 1 })],
            lastTurnTime: new Date('2026-08-02T00:00:00.000Z'),
        });
        await expect(
            started.handler.handle(
                { type: 'dieOnPrestart', requestId: 'die-started', userId: 'owner-7', generalId: 7 },
                { db: started.db }
            )
        ).resolves.toMatchObject({ ok: false, reason: '게임이 시작되었습니다.' });

        const nation = buildFixture({ generals: [buildGeneral({ nationId: 1 })] });
        await expect(
            nation.handler.handle(
                { type: 'dieOnPrestart', requestId: 'die-nation', userId: 'owner-7', generalId: 7 },
                { db: nation.db }
            )
        ).resolves.toMatchObject({ ok: false, reason: '이미 국가에 소속되어있습니다.' });

        const actorMismatch = buildFixture({ eventActor: 'foreign-user' });
        await expect(
            actorMismatch.handler.handle(
                { type: 'dieOnPrestart', requestId: 'die-actor', userId: 'owner-7', generalId: 7 },
                { db: actorMismatch.db }
            )
        ).rejects.toThrow('input event actor does not match dieOnPrestart user');

        const ownerMismatch = buildFixture({});
        await expect(
            ownerMismatch.handler.handle(
                { type: 'dieOnPrestart', requestId: 'die-owner', userId: 'foreign-user', generalId: 7 },
                { db: ownerMismatch.db }
            )
        ).resolves.toMatchObject({ ok: false, reason: '장수가 없습니다' });
    });

    it('allows the equality boundary and queues troop cleanup, lifecycle, and exact global log together', async () => {
        const leader = buildGeneral({
            troopId: 7,
            meta: { killturn: 3, prestart_delete_after: acceptedAt.toISOString() },
        });
        const member = buildGeneral({ id: 8, userId: 'owner-8', name: '부대원', troopId: 7 });
        const fixture = buildFixture({
            generals: [leader, member],
            troops: [{ id: 7, nationId: 0, name: '테스트부대' }],
        });
        await expect(
            fixture.handler.handle(
                { type: 'dieOnPrestart', requestId: 'die-success', userId: 'owner-7', generalId: 7 },
                { db: fixture.db }
            )
        ).resolves.toEqual({ type: 'dieOnPrestart', ok: true, generalId: 7 });

        expect(fixture.world.getGeneralById(7)).toBeNull();
        expect(fixture.world.getGeneralById(8)?.troopId).toBe(0);
        const changes = fixture.world.peekDirtyState();
        expect(changes.deletedTroops).toEqual([7]);
        expect(changes.deletedGenerals).toEqual([7]);
        expect(changes.lifecycleEvents).toEqual([
            expect.objectContaining({
                generalId: 7,
                outcome: 'deleted',
                before: expect.objectContaining({ troopId: 0 }),
                year: 185,
                month: 1,
            }),
        ]);
        expect(changes.logs).toEqual([
            expect.objectContaining({
                scope: 'SYSTEM',
                category: 'SUMMARY',
                text: '<Y>테스트장수</>가 홀연히 모습을 <R>감추었습니다</>',
            }),
        ]);
    });

    it('persists a legacy cutoff on early failure without queuing deletion or a log', async () => {
        const fixture = buildFixture({ lastRefresh: acceptedAt, minTurns: 1 });
        await expect(
            fixture.handler.handle(
                { type: 'dieOnPrestart', requestId: 'die-early', userId: 'owner-7', generalId: 7 },
                { db: fixture.db }
            )
        ).resolves.toMatchObject({
            ok: false,
            reason: '아직 삭제할 수 없습니다. 2026-07-31 09:10:00 부터 가능합니다.',
        });
        expect(fixture.world.getGeneralById(7)?.meta.prestart_delete_after).toBe('2026-07-31T00:10:00.000Z');
        expect(fixture.world.peekDirtyState()).toMatchObject({
            deletedGenerals: [],
            lifecycleEvents: [],
            logs: [],
        });
    });
});
