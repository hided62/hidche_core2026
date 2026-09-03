import { describe, expect, it, vi } from 'vitest';

import type { TurnDaemonCommand } from '@sammo-ts/common';

import type { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { normalizeTurnDaemonCommand } from '../src/turn/commandRegistry.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';

const buildActorBoundCommands = (userId = 'old-owner'): TurnDaemonCommand[] => [
    { type: 'troopCreate', requestId: 'troopCreate', userId, generalId: 7, troopName: '백마대' },
    { type: 'troopJoin', requestId: 'troopJoin', userId, generalId: 7, troopId: 8 },
    { type: 'troopExit', requestId: 'troopExit', userId, generalId: 7 },
    { type: 'troopKick', requestId: 'troopKick', userId, generalId: 7, troopId: 7, targetGeneralId: 8 },
    { type: 'troopRename', requestId: 'troopRename', userId, generalId: 7, troopId: 7, troopName: '신대' },
    { type: 'vacation', requestId: 'vacation', userId, generalId: 7 },
    { type: 'setMySetting', requestId: 'setMySetting', userId, generalId: 7, settings: { tnmt: 1 } },
    { type: 'dropItem', requestId: 'dropItem', userId, generalId: 7, itemType: 'weapon' },
    {
        type: 'auctionOpen',
        requestId: 'auctionOpen',
        userId,
        generalId: 7,
        auctionType: 'BUY_RICE',
        amount: 1_000,
        closeTurnCnt: 3,
        startBidAmount: 100,
        finishBidAmount: 500,
    },
    { type: 'auctionBid', requestId: 'auctionBid', userId, generalId: 7, auctionId: 1, amount: 200 },
    {
        type: 'changePermission',
        requestId: 'changePermission',
        userId,
        generalId: 7,
        isAmbassador: true,
        targetGeneralIds: [],
    },
    { type: 'kick', requestId: 'kick', userId, generalId: 7, destGeneralId: 8 },
    {
        type: 'appoint',
        requestId: 'appoint',
        userId,
        generalId: 7,
        destGeneralId: 8,
        destCityId: 1,
        officerLevel: 4,
    },
    { type: 'voteReward', requestId: 'voteReward', userId, generalId: 7, voteId: 1, selection: [0] },
    {
        type: 'syncDiplomaticResponse',
        requestId: 'syncDiplomaticResponse',
        userId,
        generalId: 7,
        messageId: 31,
        nationIds: [1, 2],
        cityIds: [1],
    },
];

const buildReadOnlyWorld = (ownerUserId: string) => {
    const mutation = vi.fn();
    const world = {
        getGeneralById: vi.fn(() => ({ id: 7, userId: ownerUserId })),
        updateGeneral: mutation,
        updateNation: mutation,
        createTroop: mutation,
        updateTroop: mutation,
        removeTroop: mutation,
        pushLog: mutation,
        queueMessage: mutation,
    } as unknown as InMemoryTurnWorld;
    return { world, mutation };
};

describe('authenticated actor-bound command registry and execution', () => {
    it.each(['horse', 'weapon', 'book', 'item'] as const)(
        'accepts the Ref equipment slot %s for dropItem',
        (itemType) => {
            expect(
                normalizeTurnDaemonCommand({
                    requestId: `drop-item:${itemType}`,
                    sentAt: '2026-08-24T00:00:00.000Z',
                    command: { type: 'dropItem', userId: 'user-7', generalId: 7, itemType },
                })
            ).toEqual({
                type: 'dropItem',
                requestId: `drop-item:${itemType}`,
                userId: 'user-7',
                generalId: 7,
                itemType,
            });
        }
    );

    it.each(['armor', '', 0, null])('rejects the invalid dropItem slot %j at the daemon boundary', (itemType) => {
        expect(
            normalizeTurnDaemonCommand({
                requestId: 'drop-item:invalid-slot',
                sentAt: '2026-08-24T00:00:00.000Z',
                command: {
                    type: 'dropItem',
                    userId: 'user-7',
                    generalId: 7,
                    itemType,
                } as unknown as TurnDaemonCommand,
            })
        ).toBeNull();
    });

    it('rejects the removed automatic diplomacy setting at the daemon boundary', () => {
        expect(
            normalizeTurnDaemonCommand({
                requestId: 'set-my-setting:removed-diplomacy',
                sentAt: '2026-08-28T00:00:00.000Z',
                command: {
                    type: 'setMySetting',
                    userId: 'user-7',
                    generalId: 7,
                    settings: {
                        use_auto_nation_diplomacy: 1,
                    },
                } as unknown as TurnDaemonCommand,
            })
        ).toBeNull();
    });

    it('rejects every actor-bound queue payload that omits userId', () => {
        for (const command of buildActorBoundCommands()) {
            const {
                userId: _userId,
                requestId: _requestId,
                ...payload
            } = command as unknown as Record<string, unknown>;
            expect(
                normalizeTurnDaemonCommand({
                    requestId: `missing-user:${command.type}`,
                    sentAt: '2026-08-24T00:00:00.000Z',
                    command: payload as TurnDaemonCommand,
                }),
                command.type
            ).toBeNull();
        }
    });

    it('rejects all stale-owner commands before any world mutation', async () => {
        const commands = buildActorBoundCommands();
        const { world, mutation } = buildReadOnlyWorld('new-owner');
        const eventTypes = new Map(commands.map((command) => [command.requestId, command.type]));
        const db = {
            inputEvent: {
                findUnique: vi.fn(async ({ where }: { where: { requestId: string } }) => ({
                    actorUserId: 'old-owner',
                    target: 'ENGINE',
                    eventType: eventTypes.get(where.requestId),
                })),
            },
        };
        const handler = createTurnDaemonCommandHandler({ world });

        for (const command of commands) {
            await expect(handler.handle(command, { db: db as never }), command.type).resolves.toMatchObject({
                type: 'commandRejected',
                ok: false,
                commandType: command.type,
            });
        }
        expect(mutation).not.toHaveBeenCalled();
    });

    it.each([
        ['missing event', null],
        ['actor mismatch', { actorUserId: 'other-owner', target: 'ENGINE', eventType: 'vacation' }],
        ['target mismatch', { actorUserId: 'old-owner', target: 'API', eventType: 'vacation' }],
        ['event type mismatch', { actorUserId: 'old-owner', target: 'ENGINE', eventType: 'dropItem' }],
    ])('returns commandRejected for %s without looking up or mutating the general', async (_label, event) => {
        const { world, mutation } = buildReadOnlyWorld('old-owner');
        const getGeneralById = world.getGeneralById as ReturnType<typeof vi.fn>;
        const handler = createTurnDaemonCommandHandler({ world });
        const result = await handler.handle(
            { type: 'vacation', requestId: 'vacation', userId: 'old-owner', generalId: 7 },
            {
                db: {
                    inputEvent: { findUnique: vi.fn(async () => event) },
                } as never,
            }
        );

        expect(result).toMatchObject({ type: 'commandRejected', ok: false, commandType: 'vacation' });
        expect(getGeneralById).not.toHaveBeenCalled();
        expect(mutation).not.toHaveBeenCalled();
    });

    it('refreshes the daemon world from the committed diplomatic response before the next turn', async () => {
        const updateNation = vi.fn();
        const applyDiplomacyPatch = vi.fn();
        const updateCity = vi.fn();
        const world = {
            getGeneralById: vi.fn(() => ({ id: 7, userId: 'old-owner' })),
            updateNation,
            applyDiplomacyPatch,
            updateCity,
        } as unknown as InMemoryTurnWorld;
        const db = {
            inputEvent: {
                findUnique: vi.fn(async () => ({
                    actorUserId: 'old-owner',
                    target: 'ENGINE',
                    eventType: 'syncDiplomaticResponse',
                })),
            },
            messageAction: { findUnique: vi.fn(async () => ({ status: 'RESOLVED' })) },
            nation: { findMany: vi.fn(async () => [{ id: 1, meta: { policy: 'balanced' } }]) },
            diplomacy: {
                findMany: vi.fn(async () => [
                    { srcNationId: 1, destNationId: 2, stateCode: 7, term: 12, meta: { dead: 3 } },
                ]),
            },
            city: { findMany: vi.fn(async () => [{ id: 4, frontState: 2 }]) },
        };
        const handler = createTurnDaemonCommandHandler({ world });

        await expect(
            handler.handle(
                {
                    type: 'syncDiplomaticResponse',
                    requestId: 'syncDiplomaticResponse',
                    userId: 'old-owner',
                    generalId: 7,
                    messageId: 31,
                    nationIds: [1, 2],
                    cityIds: [4],
                },
                { db: db as never }
            )
        ).resolves.toEqual({
            type: 'syncDiplomaticResponse',
            ok: true,
            generalId: 7,
            messageId: 31,
            nations: 1,
            diplomacy: 1,
            cities: 1,
        });
        expect(updateNation).toHaveBeenCalledWith(1, { meta: { policy: 'balanced' } });
        expect(applyDiplomacyPatch).toHaveBeenCalledWith({
            srcNationId: 1,
            destNationId: 2,
            patch: { state: 7, term: 12, dead: 3, meta: {} },
        });
        expect(updateCity).toHaveBeenCalledWith(4, { frontState: 2 });
    });

    it('preserves direct in-memory invocation when no command database is supplied', async () => {
        const updateGeneral = vi.fn();
        const world = {
            getGeneralById: vi.fn(() => ({ id: 7, userId: 'current-owner', meta: { killturn: 12 } })),
            getState: vi.fn(() => ({ meta: { killturn: 24, autorun_user: {} } })),
            updateGeneral,
        } as unknown as InMemoryTurnWorld;
        const handler = createTurnDaemonCommandHandler({ world });

        await expect(handler.handle({ type: 'vacation', userId: 'different-owner', generalId: 7 })).resolves.toEqual({
            type: 'vacation',
            ok: true,
            generalId: 7,
        });
        expect(updateGeneral).toHaveBeenCalledWith(7, { meta: { killturn: 72 } });
    });
});
