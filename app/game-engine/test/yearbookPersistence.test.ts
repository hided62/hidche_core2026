import { describe, expect, it, vi } from 'vitest';

import type { GamePrisma } from '@sammo-ts/infra';
import { LogCategory, LogScope } from '@sammo-ts/logic';

import { persistYearbookSnapshot } from '../src/turn/yearbookPersistence.js';

describe('persistYearbookSnapshot', () => {
    it('archives canonical summary logs and compatible action logs together in descending ID order', async () => {
        const findMany = vi
            .fn()
            .mockResolvedValueOnce([{ text: '천하 동향' }])
            .mockResolvedValueOnce([{ text: '호환 행동' }, { text: '장수 동향' }]);
        const upsert = vi.fn().mockResolvedValue(undefined);
        const transaction = {
            logEntry: { findMany },
            yearbookHistory: { upsert },
        } as unknown as GamePrisma.TransactionClient;

        await persistYearbookSnapshot(transaction, {
            serverId: 'hwe:generation',
            sourceId: 0,
            year: 195,
            month: 1,
            map: { year: 195, month: 1 },
            nations: [],
        });

        expect(findMany).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                where: {
                    scope: LogScope.SYSTEM,
                    category: { in: [LogCategory.SUMMARY, LogCategory.ACTION] },
                    year: 195,
                    month: 1,
                },
                orderBy: { id: 'desc' },
            })
        );
        expect(upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({ globalAction: ['호환 행동', '장수 동향'] }),
                update: expect.objectContaining({ globalAction: ['호환 행동', '장수 동향'] }),
            })
        );
    });
});
