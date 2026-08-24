import { describe, expect, it, vi } from 'vitest';

import type { GamePrisma } from '@sammo-ts/infra';
import { LogCategory, LogScope } from '@sammo-ts/logic';

import { persistGeneralLifecycleEvents } from '../src/turn/generalTurnLifecyclePersistence.js';
import type { GeneralLifecycleEvent } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral } from '../src/turn/types.js';

const archivedGeneral = (): TurnGeneral => ({
    id: 91,
    userId: null,
    name: '기록장수',
    nationId: 0,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    experience: 1_000,
    dedication: 500,
    officerLevel: 0,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 1,
    train: 0,
    atmos: 0,
    age: 70,
    npcState: 2,
    bornYear: 170,
    deadYear: 240,
    affinity: 50,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: {
        killturn: 0,
        dex1: 1_000,
        inheritRandomUnique: true,
        inheritSpecificSpecialWar: true,
    },
    turnTime: new Date('0200-01-01T00:00:00.000Z'),
});

describe('general lifecycle archive history', () => {
    it('stores the general history in descending log order when a general is deleted', async () => {
        const general = archivedGeneral();
        const upsert = vi.fn(async () => undefined);
        const prisma = {
            generalAccessLog: {
                updateMany: vi.fn(async () => ({ count: 1 })),
                deleteMany: vi.fn(async () => ({ count: 1 })),
            },
            logEntry: {
                findMany: vi.fn(async () => [
                    { category: LogCategory.BATTLE_BRIEF, text: '둘째 전투 결과' },
                    { category: LogCategory.HISTORY, text: '<Y>●</>둘째 기록' },
                    { category: LogCategory.BATTLE_BRIEF, text: '첫째 전투 결과' },
                    { category: LogCategory.HISTORY, text: '<C>●</>첫 기록' },
                ]),
            },
            rankData: {
                findMany: vi.fn(async () => [
                    { type: 'warnum', value: 2 },
                    { type: 'killnum', value: 1 },
                ]),
            },
            oldGeneral: { upsert },
        } as unknown as GamePrisma.TransactionClient;
        const event: GeneralLifecycleEvent = {
            generalId: general.id,
            outcome: 'deleted',
            before: general,
            year: 200,
            month: 1,
        };

        await persistGeneralLifecycleEvents(prisma, [event], { serverId: 'archive-fixture' }, {});

        expect(prisma.logEntry.findMany).toHaveBeenCalledWith({
            where: {
                generalId: general.id,
                scope: LogScope.GENERAL,
                category: { in: [LogCategory.HISTORY, LogCategory.BATTLE_BRIEF] },
            },
            orderBy: { id: 'desc' },
            select: { category: true, text: true },
        });
        expect(upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({
                    data: expect.objectContaining({
                        history: ['<Y>●</>둘째 기록', '<C>●</>첫 기록'],
                        records: { battleResult: ['둘째 전투 결과', '첫째 전투 결과'] },
                        availability: { battleResultLogs: true },
                        meta: expect.objectContaining({
                            killturn: 0,
                            dex1: 1_000,
                            rank_warnum: 2,
                            rank_killnum: 1,
                            inheritRandomUnique: true,
                            inheritSpecificSpecialWar: true,
                        }),
                    }),
                }),
            })
        );
    });

    it('stores the inheritance earned rank in the hall before a rebirth resets ranks', async () => {
        const general = archivedGeneral();
        const hallCreate = vi.fn(async () => undefined);
        general.userId = 'hall-owner';
        general.meta = {
            ...general.meta,
            rank_warnum: 11,
            inherit_earned: 4_321,
            dex1: 200,
            event100_allstar: { granted: { dex1: 80 } },
        };
        const postRetirement = {
            ...general,
            meta: {
                ...general.meta,
                rank_warnum: 0,
                inherit_earned: 0,
            },
        };
        const rankUpsert = vi.fn(async () => undefined);
        const prisma = {
            generalAccessLog: {
                updateMany: vi.fn(async () => ({ count: 1 })),
            },
            rankData: {
                findMany: vi.fn(async () => [
                    { type: 'warnum', value: 10 },
                    { type: 'inherit_earned', value: 123 },
                ]),
                upsert: rankUpsert,
            },
            nation: {
                findUnique: vi.fn(async () => null),
            },
            gameHistory: {
                count: vi.fn(async () => 99),
            },
            hallOfFame: {
                findMany: vi.fn(async () => []),
                create: hallCreate,
                update: vi.fn(async () => undefined),
            },
            inheritancePoint: {
                findMany: vi.fn(async () => [{ key: 'previous', value: 0 }]),
                upsert: vi.fn(async () => undefined),
                deleteMany: vi.fn(async () => ({ count: 0 })),
            },
            inheritanceResult: { create: vi.fn(async () => undefined) },
            inheritanceLog: { create: vi.fn(async () => undefined) },
        } as unknown as GamePrisma.TransactionClient;
        const event: GeneralLifecycleEvent = {
            generalId: general.id,
            outcome: 'retired',
            before: general,
            after: postRetirement,
            isUnitedAtEvent: 0,
            year: 200,
            month: 1,
        };

        await persistGeneralLifecycleEvents(
            prisma,
            [event],
            { serverId: 'hall-fixture', season: 4, scenarioId: 22, isUnited: 2, gameIdx: 7 },
            {},
            new Date('0200-02-01T00:00:00.000Z')
        );

        expect(hallCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                serverId: 'hall-fixture',
                season: 4,
                scenario: 22,
                generalNo: general.id,
                type: 'inherit_earned',
                value: 4_321,
            }),
        });
        expect(hallCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({ type: 'warnum', value: 11 }),
        });
        expect(hallCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                type: 'dex1',
                value: 120,
                aux: expect.objectContaining({ serverIdx: 7, unitedTime: '0200-02-01T00:00:00.000Z' }),
            }),
        });
        expect(prisma.gameHistory.count).not.toHaveBeenCalled();
        expect(prisma.inheritanceLog.create).not.toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ text: expect.stringContaining('반환') }) })
        );
        expect(rankUpsert).toHaveBeenCalledWith({
            where: { generalId_type: { generalId: general.id, type: 'warnum' } },
            update: { nationId: general.nationId, value: 0 },
            create: { generalId: general.id, nationId: general.nationId, type: 'warnum', value: 0 },
        });
    });
});
