import { describe, expect, it } from 'vitest';

import { IdempotentTurnDaemonTransport } from '../src/daemon/idempotentTransport.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import {
    commandIdentityJson,
    ConflictingTurnDaemonCommandError,
    DatabaseTurnDaemonTransport,
} from '../src/daemon/databaseTransport.js';

describe('IdempotentTurnDaemonTransport', () => {
    it('derives stable ordered engine request IDs from the API input event', async () => {
        const inner = new InMemoryTurnDaemonTransport();
        const firstAttempt = new IdempotentTurnDaemonTransport(inner, 'api-event');
        const retry = new IdempotentTurnDaemonTransport(inner, 'api-event');

        await firstAttempt.sendCommand({ type: 'vacation', userId: 'user-7', generalId: 7 });
        await firstAttempt.sendCommand({ type: 'dropItem', userId: 'user-7', generalId: 7, itemType: 'weapon' });
        await retry.sendCommand({ type: 'vacation', userId: 'user-7', generalId: 7 });

        expect(inner.commands.map((entry) => entry.requestId)).toEqual([
            'api-event:engine:0:vacation',
            'api-event:engine:1:dropItem',
            'api-event:engine:0:vacation',
        ]);
    });

    it('keeps the first durable acceptance tick authoritative across an idempotent retry', () => {
        const auctionBid = {
            type: 'auctionBid',
            requestId: 'auction-bid',
            userId: 'user-7',
            auctionId: 31,
            generalId: 7,
            amount: 500,
            acceptedGameTick: 100,
        };
        expect(commandIdentityJson({ ...auctionBid, acceptedGameTick: 101 })).toBe(commandIdentityJson(auctionBid));
        expect(commandIdentityJson({ ...auctionBid, amount: 501 })).not.toBe(commandIdentityJson(auctionBid));

        const voteReward = {
            type: 'voteReward',
            requestId: 'vote-reward',
            userId: 'user-7',
            voteId: 1,
            generalId: 7,
            selection: [0],
            acceptedGameTick: 100,
        };
        expect(commandIdentityJson({ ...voteReward, acceptedGameTick: 101 })).toBe(commandIdentityJson(voteReward));
        expect(commandIdentityJson({ ...voteReward, selection: [1] })).not.toBe(commandIdentityJson(voteReward));

        const selectionCommands = [
            {
                type: 'selectPoolReserve',
                requestId: 'select-pool-reserve',
                userId: 'user-7',
                seedOwnerIdentity: 7,
                acceptedGameAt: '0200-01-01T00:00:00.000Z',
                acceptedGameTick: 100,
            },
            {
                type: 'selectPoolCreate',
                requestId: 'select-pool-create',
                userId: 'user-7',
                ownerDisplayName: '사용자',
                uniqueName: '풀장수',
                personality: 'che_안전',
                acceptedGameAt: '0200-01-01T00:00:00.000Z',
                acceptedGameTick: 100,
            },
            {
                type: 'selectPoolReselect',
                requestId: 'select-pool-reselect',
                userId: 'user-7',
                ownerDisplayName: '사용자',
                uniqueName: '풀장수',
                acceptedGameAt: '0200-01-01T00:00:00.000Z',
                acceptedGameTick: 100,
            },
        ];
        for (const command of selectionCommands) {
            expect(
                commandIdentityJson({
                    ...command,
                    acceptedGameAt: '0200-01-01T00:01:00.000Z',
                    acceptedGameTick: 101,
                })
            ).toBe(commandIdentityJson(command));
            expect(commandIdentityJson({ ...command, userId: 'other-user' })).not.toBe(commandIdentityJson(command));
        }
    });

    it('reuses a rolling-upgrade vote event after legacy acceptance coordinates are removed', async () => {
        const persistedPayload = {
            type: 'voteReward' as const,
            requestId: 'vote-reward',
            userId: 'user-7',
            voteId: 1,
            generalId: 7,
            selection: [0],
            acceptedGameTick: 100,
        };
        const currentCommand = {
            type: 'voteReward' as const,
            requestId: 'vote-reward',
            userId: 'user-7',
            voteId: 1,
            generalId: 7,
            selection: [0],
        };
        const create = async () => {
            throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        };
        const transport = new DatabaseTurnDaemonTransport(
            {
                inputEvent: {
                    create,
                    findUniqueOrThrow: async () => ({ eventType: 'voteReward', payload: persistedPayload }),
                },
            } as any,
            100
        );

        await expect(
            transport.sendCommand(currentCommand)
        ).resolves.toBe('vote-reward');

        for (const changedIdentity of [{ selection: [1] }, { voteId: 2 }, { generalId: 8 }]) {
            await expect(
                transport.sendCommand({
                    ...currentCommand,
                    ...changedIdentity,
                })
            ).rejects.toBeInstanceOf(ConflictingTurnDaemonCommandError);
        }
    });
});
