import { describe, expect, it, vi } from 'vitest';

import type { GamePrisma } from '@sammo-ts/infra';
import type { MessagePayload } from '@sammo-ts/logic';

import { respondToActionableMessage } from '../src/turn/actionableMessageResponse.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { ImmediateGeneralActionExecutor } from '../src/turn/reservedTurnHandler.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const actor: TurnGeneral = {
    id: 7,
    userId: 'user-7',
    name: '수신자',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 60, intelligence: 50 },
    turnTime: new Date('0200-01-01T00:10:00.000Z'),
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    penalty: {},
    officerLevel: 1,
    experience: 100,
    dedication: 100,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
};

const buildWorld = (): InMemoryTurnWorld => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 200,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
        meta: { hiddenSeed: 'actionable-message-test', isunited: 2 },
    };
    const snapshot: TurnWorldSnapshot = {
        generals: [actor],
        cities: [],
        nations: [],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'default' },
        },
        map: { id: 'test', name: 'test', cities: [] },
    };
    return new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
};

const source = {
    generalId: 8,
    generalName: '제안자',
    nationId: 2,
    nationName: '촉',
    color: '#000000',
    icon: '',
};
const destination = {
    generalId: actor.id,
    generalName: actor.name,
    nationId: actor.nationId,
    nationName: '위',
    color: '#ffffff',
    icon: '',
};

const buildRow = (action: 'scout' | 'raiseInvader', overrides: Partial<MessagePayload> = {}) => ({
    id: 29,
    mailbox: actor.id,
    type: 'private',
    time: new Date('0200-01-01T00:00:00.000Z'),
    validUntil: new Date('9999-12-31T00:00:00.000Z'),
    message: {
        src: source,
        dest: destination,
        text: '응답할 메시지',
        option: { action, used: false, ...(action === 'raiseInvader' ? { args: [-2, -1.2, -1, -0.5] } : {}) },
        ...overrides,
    } satisfies MessagePayload,
});

const buildDb = (rows: unknown[][]) => {
    const queryRaw = vi.fn(async () => rows.shift() ?? []);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    return {
        db: { $queryRaw: queryRaw, message: { updateMany } } as unknown as GamePrisma.TransactionClient,
        queryRaw,
        updateMany,
    };
};

const buildExecutor = (ok = true): ImmediateGeneralActionExecutor => ({
    execute: vi.fn(async () => (ok ? { ok: true } : { ok: false, reason: '등용 수락 불가.' })),
});

describe('actionable message response', () => {
    it('accepts a recruitment letter, executes the legacy action, and invalidates linked prompts', async () => {
        const world = buildWorld();
        const row = buildRow('scout');
        const { db, updateMany } = buildDb([[row], [{ id: 31 }]]);
        const executor = buildExecutor();

        const result = await respondToActionableMessage({
            db,
            world,
            executor,
            userId: actor.userId!,
            generalId: actor.id,
            messageId: row.id,
            response: true,
        });

        expect(result).toEqual({ ok: true, action: 'scout', reason: 'success' });
        expect(executor.execute).toHaveBeenCalledWith(
            expect.objectContaining({
                actionKey: 'che_등용수락',
                generalId: actor.id,
                args: { destNationId: source.nationId, destGeneralId: source.generalId },
            })
        );
        expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [row.id, 31] } } }));
        expect(world.peekDirtyState().messages).toEqual([
            expect.objectContaining({
                msgType: 'private',
                text: '촉으로 등용 제의 수락',
                sendDestOnly: true,
                option: { delete: row.id },
            }),
        ]);
    });

    it('keeps a recruitment letter valid when the legacy accept constraints reject it', async () => {
        const world = buildWorld();
        const row = buildRow('scout');
        const { db, updateMany } = buildDb([[row]]);

        const result = await respondToActionableMessage({
            db,
            world,
            executor: buildExecutor(false),
            userId: actor.userId!,
            generalId: actor.id,
            messageId: row.id,
            response: true,
        });

        expect(result).toEqual({ ok: true, action: 'scout', reason: '등용 수락 불가.' });
        expect(updateMany).not.toHaveBeenCalled();
        expect(world.peekDirtyState().messages).toHaveLength(0);
    });

    it('treats legacy truthy used values and an inverted validity interval as invalid scout letters', async () => {
        for (const row of [
            buildRow('scout', { option: { action: 'scout', used: 1 } }),
            {
                ...buildRow('scout'),
                validUntil: new Date('0199-12-31T23:59:59.000Z'),
            },
        ]) {
            const world = buildWorld();
            const { db, updateMany } = buildDb([[row]]);
            const executor = buildExecutor();

            await expect(
                respondToActionableMessage({
                    db,
                    world,
                    executor,
                    userId: actor.userId!,
                    generalId: actor.id,
                    messageId: row.id,
                    response: true,
                })
            ).resolves.toEqual({ ok: false, action: 'scout', reason: '유효하지 않은 등용장입니다.' });
            expect(executor.execute).not.toHaveBeenCalled();
            expect(updateMany).not.toHaveBeenCalled();
        }
    });

    it("keeps PHP's special string-zero used value false", async () => {
        const world = buildWorld();
        const row = buildRow('scout', { option: { action: 'scout', used: '0' } });
        const { db, updateMany } = buildDb([[row], []]);
        const executor = buildExecutor();

        await expect(
            respondToActionableMessage({
                db,
                world,
                executor,
                userId: actor.userId!,
                generalId: actor.id,
                messageId: row.id,
                response: true,
            })
        ).resolves.toEqual({ ok: true, action: 'scout', reason: 'success' });
        expect(executor.execute).toHaveBeenCalledOnce();
        expect(updateMany).toHaveBeenCalledOnce();
    });

    it('rejects malformed actionable payloads without throwing inside the daemon transaction', async () => {
        const world = buildWorld();
        const row = { ...buildRow('scout'), message: { option: { action: 'scout' }, dest: null } };
        const { db, updateMany } = buildDb([[row]]);
        const executor = buildExecutor();

        await expect(
            respondToActionableMessage({
                db,
                world,
                executor,
                userId: actor.userId!,
                generalId: actor.id,
                messageId: row.id,
                response: true,
            })
        ).resolves.toEqual({ ok: false, reason: '응답할 수 없는 메시지입니다.' });
        expect(executor.execute).not.toHaveBeenCalled();
        expect(updateMany).not.toHaveBeenCalled();
    });

    it('does not invalidate an invader prompt before validating its receiver', async () => {
        const world = buildWorld();
        const row = { ...buildRow('raiseInvader'), mailbox: 99 };
        const { db, updateMany } = buildDb([[row]]);

        const result = await respondToActionableMessage({
            db,
            world,
            executor: buildExecutor(),
            userId: actor.userId!,
            generalId: actor.id,
            messageId: row.id,
            response: false,
        });

        expect(result).toEqual({ ok: false, action: 'raiseInvader', reason: '올바른 수신자가 아닙니다.' });
        expect(updateMany).not.toHaveBeenCalled();
    });

    it('invalidates a valid invader prompt when it is declined', async () => {
        const world = buildWorld();
        const row = buildRow('raiseInvader');
        const { db, updateMany } = buildDb([[row]]);

        const result = await respondToActionableMessage({
            db,
            world,
            executor: buildExecutor(),
            userId: actor.userId!,
            generalId: actor.id,
            messageId: row.id,
            response: false,
        });

        expect(result).toEqual({ ok: true, action: 'raiseInvader', reason: 'success' });
        expect(updateMany).toHaveBeenCalledOnce();
    });
});
