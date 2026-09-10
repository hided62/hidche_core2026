import { afterAll, describe, expect, it, vi } from 'vitest';
import { createGamePostgresConnector } from '@sammo-ts/infra';
import { fetchMessagesFromMailbox, fetchOldMessagesFromMailbox } from '../src/messages/store.js';

vi.mock('../src/services/gameClock.js', () => ({
    loadCurrentGameTime: vi.fn(async () => ({ tick: 100 })),
}));

// SQL is mocked; this client is never connected. Keep the real delegate types.
const connector = createGamePostgresConnector({ url: 'postgresql://localhost:1/message_lifecycle_unit' });
const db = connector.prisma;
const queryRaw = vi.spyOn(db, '$queryRaw');
afterAll(() => connector.disconnect());

const target = { generalId: 1, generalName: '장수', nationId: 1, nationName: '국가', color: '#000', icon: '' };

for (const older of [false, true]) {
    describe(older ? 'older message lifecycle' : 'recent message lifecycle', () => {
        it.each([
            ['PENDING', 101n, 'pending', false],
            ['PENDING', 100n, 'expired', true],
            ['PENDING', 99n, 'expired', true],
            ['PENDING', null, 'pending', false],
            ['RESOLVED', 101n, 'resolved', true],
            ['RESOLVED', 99n, 'resolved', true],
            ['CANCELLED', 101n, 'unavailable', true],
            ['UNKNOWN', 101n, 'unavailable', true],
            [null, null, undefined, undefined],
        ])('preserves body for status %s and deadline %s', async (status, deadline, state, used) => {
            const row = {
                id: 10,
                mailbox: 1,
                type: 'diplomacy',
                src: 2,
                dest: 1,
                time: new Date('0200-01-01T00:00:00Z'),
                created_at_wall: new Date('2026-09-10T00:00:00Z'),
                action_status: status,
                expires_game_tick: deadline,
                message: {
                    src: target,
                    dest: target,
                    text: '210년 1월까지 불가침 제의',
                    option: { action: 'noAggression' },
                },
            };
            queryRaw.mockResolvedValue([row]);
            const options = { db, mailbox: 1, msgType: 'diplomacy' as const, limit: 20 };
            const result = older
                ? await fetchOldMessagesFromMailbox({ ...options, toSeq: 11 })
                : await fetchMessagesFromMailbox({ ...options, fromSeq: 0 });
            expect(result[0]?.text).toBe(row.message.text);
            expect(result[0]?.option?.invalid).toBeUndefined();
            expect(result[0]?.option?.actionState).toBe(state);
            expect(result[0]?.option?.used).toBe(used);
        });

        it('keeps actual deletion authoritative even when an action remains', async () => {
            queryRaw.mockResolvedValue([
                {
                    id: 10,
                    type: 'diplomacy',
                    time: new Date(),
                    created_at_wall: new Date(),
                    action_status: 'RESOLVED',
                    expires_game_tick: 99n,
                    message: {
                        src: target,
                        dest: target,
                        text: '삭제된 메시지입니다.',
                        option: { action: 'noAggression', invalid: true },
                    },
                },
            ]);
            const options = { db, mailbox: 1, msgType: 'diplomacy' as const, limit: 20 };
            const result = older
                ? await fetchOldMessagesFromMailbox({ ...options, toSeq: 11 })
                : await fetchMessagesFromMailbox({ ...options, fromSeq: 0 });
            expect(result[0]).toMatchObject({ text: '삭제된 메시지입니다.', option: { invalid: true, used: true } });
        });
    });
}
