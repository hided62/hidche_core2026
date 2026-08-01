import { describe, expect, it, vi } from 'vitest';

import type { GamePrisma } from '@sammo-ts/infra';
import type { TurnSchedule } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';

const revision = '2026-07-31T09:00:00.000Z';
const requestId = `general:adjustIcon:user-1:${revision}`;
const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };

const buildGeneral = (overrides: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id: 1,
    userId: 'user-1',
    name: '아이콘장수',
    nationId: 0,
    cityId: 0,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    turnTime: new Date('2026-07-31T09:00:00.000Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    officerLevel: 0,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 0,
    rice: 0,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 20,
    npcState: 0,
    picture: 'old.jpg',
    imageServer: 0,
    ...overrides,
});

const buildWorld = (generals: TurnGeneral[]) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 190,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('2026-07-31T09:00:00.000Z'),
        meta: {},
    };
    const snapshot: TurnWorldSnapshot = {
        generals,
        cities: [],
        nations: [],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 65 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'test' },
        },
        scenarioMeta: {
            title: 'test',
            startYear: 190,
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
    return new InMemoryTurnWorld(state, snapshot, { schedule });
};

const buildCommandDb = (actorUserId = 'user-1', acceptedAt = new Date('2026-07-31T09:00:00.000Z')) =>
    ({
        inputEvent: {
            findUnique: vi.fn(async () => ({
                createdAt: acceptedAt,
                actorUserId,
                target: 'ENGINE',
                eventType: 'adjustGeneralIcon',
            })),
        },
    }) as unknown as GamePrisma.TransactionClient;

const command = (
    overrides: Partial<{
        requestId: string;
        userId: string;
        picture: string;
        imageServer: number;
        iconRevision: string;
        enforceCooldown: boolean;
    }> = {}
) => ({
    type: 'adjustGeneralIcon' as const,
    requestId,
    userId: 'user-1',
    picture: 'new.png',
    imageServer: 1,
    iconRevision: revision,
    ...overrides,
});

describe('adjustGeneralIcon ENGINE command', () => {
    it('updates only the authenticated human general and preserves existing meta', async () => {
        const human = buildGeneral();
        const possessedNpc = buildGeneral({ id: 2, npcState: 1 });
        const foreign = buildGeneral({ id: 3, userId: 'user-2' });
        const world = buildWorld([human, possessedNpc, foreign]);
        const handler = createTurnDaemonCommandHandler({ world });

        await expect(handler.handle(command(), { db: buildCommandDb() })).resolves.toEqual({
            type: 'adjustGeneralIcon',
            ok: true,
            generalId: human.id,
            updated: true,
        });
        expect(world.getGeneralById(human.id)).toMatchObject({
            picture: 'new.png',
            imageServer: 1,
            meta: {
                killturn: 24,
                accountIconUpdatedAt: revision,
            },
        });
        expect(world.getGeneralById(possessedNpc.id)).toMatchObject({ picture: 'old.jpg', imageServer: 0 });
        expect(world.getGeneralById(foreign.id)).toMatchObject({ picture: 'old.jpg', imageServer: 0 });
    });

    it('treats no human general as a successful no-op', async () => {
        const world = buildWorld([buildGeneral({ id: 2, npcState: 1 }), buildGeneral({ id: 3, userId: 'user-2' })]);
        const handler = createTurnDaemonCommandHandler({ world });

        await expect(handler.handle(command(), { db: buildCommandDb() })).resolves.toEqual({
            type: 'adjustGeneralIcon',
            ok: true,
            generalId: null,
            updated: false,
        });
    });

    it('keeps an identical revision idempotent and rejects rollback or tuple conflicts', async () => {
        const world = buildWorld([
            buildGeneral({
                picture: 'new.png',
                imageServer: 1,
                meta: { killturn: 24, accountIconUpdatedAt: revision },
            }),
        ]);
        const handler = createTurnDaemonCommandHandler({ world });

        await expect(handler.handle(command(), { db: buildCommandDb() })).resolves.toMatchObject({
            ok: true,
            updated: false,
        });
        await expect(
            handler.handle(command({ iconRevision: '2026-07-31T08:59:59.000Z' }), {
                db: buildCommandDb(),
            })
        ).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
        await expect(
            handler.handle(command({ picture: 'conflict.png' }), { db: buildCommandDb() })
        ).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
        expect(world.getGeneralById(1)).toMatchObject({ picture: 'new.png', imageServer: 1 });
    });

    it('fails closed for a corrupt watermark or mismatched input-event actor', async () => {
        const corruptWorld = buildWorld([buildGeneral({ meta: { killturn: 24, accountIconUpdatedAt: 'not-a-date' } })]);
        const corruptHandler = createTurnDaemonCommandHandler({ world: corruptWorld });
        await expect(corruptHandler.handle(command(), { db: buildCommandDb() })).resolves.toMatchObject({
            ok: false,
            code: 'PRECONDITION_FAILED',
        });

        const actorWorld = buildWorld([buildGeneral()]);
        const actorHandler = createTurnDaemonCommandHandler({ world: actorWorld });
        await expect(actorHandler.handle(command(), { db: buildCommandDb('user-2') })).rejects.toThrow(
            'actor does not match'
        );
        expect(actorWorld.getGeneralById(1)).toMatchObject({ picture: 'old.jpg', imageServer: 0 });
    });

    it('allows human in-game changes only after a rolling 24-hour window', async () => {
        const changedAt = '2026-07-31T08:00:00.000Z';
        const world = buildWorld([buildGeneral({ meta: { killturn: 24, generalIconChangedAt: changedAt } })]);
        const handler = createTurnDaemonCommandHandler({ world });
        const manual = command({ enforceCooldown: true });

        await expect(handler.handle(manual, { db: buildCommandDb() })).resolves.toMatchObject({
            ok: false,
            code: 'TOO_MANY_REQUESTS',
            availableAt: '2026-08-01T08:00:00.000Z',
        });
        expect(world.getGeneralById(1)).toMatchObject({ picture: 'old.jpg' });

        await expect(
            handler.handle(manual, { db: buildCommandDb('user-1', new Date('2026-08-01T08:00:00.000Z')) })
        ).resolves.toMatchObject({ ok: true, updated: true });
        expect(world.getGeneralById(1)).toMatchObject({
            picture: 'new.png',
            meta: { generalIconChangedAt: '2026-08-01T08:00:00.000Z' },
        });
    });
});
