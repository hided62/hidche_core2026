import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { LogCategory, LogScope } from '@sammo-ts/logic';

import type { DatabaseClient, GameApiContext } from '../src/context.js';
import { appRouter } from '../src/router.js';

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-07-26T00:00:00.000Z',
    expiresAt: '2026-07-27T00:00:00.000Z',
    sessionId: 'session-owner',
    user: {
        id: 'owner',
        username: 'owner',
        displayName: 'Owner',
        roles: [],
    },
    sanctions: {},
};

type LogQuery = {
    where: {
        scope: LogScope;
        category: LogCategory | { in: LogCategory[] };
        generalId?: number;
        id: { gte: number };
    };
    orderBy: { id: 'desc' };
    take: number;
    select: { id: true; text: true; createdAt: true };
};

const buildContext = (findMany: (query: LogQuery) => Promise<Array<{ id: number; text: string }>>) =>
    ({
        auth,
        db: {
            general: {
                findFirst: vi.fn(async ({ where }: { where: { userId: string } }) => ({
                    id: 7,
                    userId: where.userId,
                })),
            },
            logEntry: { findMany },
        } as unknown as DatabaseClient,
    }) as GameApiContext;

describe('general.getRecentRecords', () => {
    it('derives the general and maps all three legacy dashboard buckets', async () => {
        const findMany = vi.fn(async (query: LogQuery) => {
            if (query.where.scope === LogScope.GENERAL) {
                return [
                    { id: 31, text: '개인 최신' },
                    { id: 20, text: '개인 cursor' },
                ];
            }
            if (typeof query.where.category === 'object' && query.where.category.in.includes(LogCategory.SUMMARY)) {
                return [
                    { id: 32, text: '장수 최신' },
                    { id: 20, text: '장수 cursor' },
                ];
            }
            return [
                { id: 42, text: '중원 최신' },
                { id: 40, text: '중원 cursor' },
            ];
        });
        const caller = appRouter.createCaller(buildContext(findMany));

        const result = await caller.general.getRecentRecords({
            lastGeneralRecordId: 20,
            lastWorldHistoryId: 40,
        });

        expect(result).toEqual({
            global: [{ id: 32, text: '장수 최신' }],
            general: [{ id: 31, text: '개인 최신' }],
            history: [{ id: 42, text: '중원 최신' }],
        });
        expect(findMany).toHaveBeenCalledTimes(3);
        expect(findMany).toHaveBeenCalledWith({
            where: {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: 7,
                id: { gte: 20 },
            },
            orderBy: { id: 'desc' },
            take: 16,
            select: { id: true, text: true, createdAt: true },
        });
    });

    it('caps an initial bucket at the legacy 15-row limit', async () => {
        const rows = Array.from({ length: 16 }, (_, index) => ({
            id: 100 - index,
            text: `기록 ${index}`,
        }));
        const caller = appRouter.createCaller(buildContext(async () => rows));

        const result = await caller.general.getRecentRecords({
            lastGeneralRecordId: 0,
            lastWorldHistoryId: 0,
        });

        expect(result.global).toHaveLength(15);
        expect(result.general).toHaveLength(15);
        expect(result.history).toHaveLength(15);
        expect(result.global.at(-1)?.id).toBe(86);
    });

    it('rejects an authenticated user without an in-game general', async () => {
        const context = buildContext(async () => []);
        context.db = {
            general: {
                findFirst: vi.fn(async () => null),
            },
            logEntry: {
                findMany: vi.fn(async () => []),
            },
        } as unknown as DatabaseClient;
        const caller = appRouter.createCaller(context);

        await expect(
            caller.general.getRecentRecords({
                lastGeneralRecordId: 0,
                lastWorldHistoryId: 0,
            })
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
});
