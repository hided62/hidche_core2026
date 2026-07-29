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
    meta: { killturn: 0 },
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
                findMany: vi.fn(async () => [{ text: '<Y>●</>둘째 기록' }, { text: '<C>●</>첫 기록' }]),
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
                category: LogCategory.HISTORY,
            },
            orderBy: { id: 'desc' },
            select: { text: true },
        });
        expect(upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({
                    data: expect.objectContaining({
                        history: ['<Y>●</>둘째 기록', '<C>●</>첫 기록'],
                    }),
                }),
            })
        );
    });
});
