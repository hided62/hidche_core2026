import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRecord } from '@sammo-ts/common';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import { LogCategory, LogScope } from '@sammo-ts/logic';

import type { GeneralLifecycleEvent } from '../src/turn/inMemoryWorld.js';
import { persistGeneralLifecycleEvents } from '../src/turn/generalTurnLifecyclePersistence.js';
import type { TurnGeneral } from '../src/turn/types.js';

const databaseUrl = process.env.GENERAL_LIFECYCLE_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const generalIds = [990_001, 990_002, 990_003];
const userIds = [
    'integration-lifecycle-dead',
    'integration-lifecycle-retired',
    'integration-lifecycle-possessed',
];
const serverId = 'integration-lifecycle';

const makeGeneral = (id: number, userId: string, patch: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id,
    userId,
    name: `lifecycle-${id}`,
    nationId: 0,
    cityId: 0,
    troopId: 0,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    experience: 1_000,
    dedication: 800,
    officerLevel: 1,
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
    age: 80,
    npcState: 0,
    bornYear: 170,
    deadYear: 260,
    affinity: 50,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: {
        killturn: 0,
        inherit_lived_month: 10,
        inherit_active_action: 2,
        dex1: 1_000,
    },
    turnTime: new Date('0200-01-01T00:00:00.000Z'),
    ...patch,
});

const event = (
    general: TurnGeneral,
    outcome: GeneralLifecycleEvent['outcome']
): GeneralLifecycleEvent => ({
    generalId: general.id,
    outcome,
    before: general,
    ...(outcome === 'deleted' ? {} : { after: general }),
    year: 200,
    month: 1,
});

integration('general turn lifecycle persistence', () => {
    let db: GamePrismaClient;
    let close: (() => Promise<void>) | undefined;

    const cleanup = async () => {
        await db.logEntry.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.generalAccessLog.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.rankData.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.oldGeneral.deleteMany({ where: { serverId, generalNo: { in: generalIds } } });
        await db.hallOfFame.deleteMany({ where: { serverId, generalNo: { in: generalIds } } });
        await db.inheritanceResult.deleteMany({ where: { serverId, owner: { in: userIds } } });
        await db.inheritanceLog.deleteMany({ where: { userId: { in: userIds } } });
        await db.inheritancePoint.deleteMany({ where: { userId: { in: userIds } } });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
        await cleanup();
    });

    afterAll(async () => {
        await cleanup();
        await close?.();
    });

    it('archives deletion, removes access state, and settles inheritance', async () => {
        const general = makeGeneral(generalIds[0]!, userIds[0]!, {
            meta: {
                killturn: 0,
                inherit_lived_month: 10,
                inherit_active_action: 2,
                inheritRandomUnique: true,
                dex1: 1_000,
            },
        });
        await db.generalAccessLog.create({
            data: { generalId: general.id, userId: general.userId, refreshScore: 99 },
        });
        await db.inheritancePoint.create({
            data: { userId: general.userId!, key: 'previous', value: 100 },
        });
        await db.rankData.createMany({
            data: [
                { generalId: general.id, nationId: 0, type: 'warnum', value: 2 },
                { generalId: general.id, nationId: 0, type: 'firenum', value: 1 },
            ],
        });
        await db.logEntry.createMany({
            data: [
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.HISTORY,
                    year: 199,
                    month: 12,
                    generalId: general.id,
                    text: '<C>●</>첫 기록',
                },
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.HISTORY,
                    year: 200,
                    month: 1,
                    generalId: general.id,
                    text: '<Y>●</>둘째 기록',
                },
            ],
        });

        await db.$transaction((tx) =>
            persistGeneralLifecycleEvents(
                tx,
                [event(general, 'deleted')],
                { serverId },
                { inheritItemRandomPoint: 3_000, inheritSpecificSpecialPoint: 4_000 }
            )
        );

        expect(await db.generalAccessLog.findUnique({ where: { generalId: general.id } })).toBeNull();
        const archived = await db.oldGeneral.findUniqueOrThrow({
            where: { by_no: { serverId, generalNo: general.id } },
        });
        expect(asRecord(archived.data).history).toEqual(['<Y>●</>둘째 기록', '<C>●</>첫 기록']);
        expect(
            await db.inheritancePoint.findUnique({
                where: { userId_key: { userId: general.userId!, key: 'previous' } },
            })
        ).toMatchObject({ value: 3_147 });
    });

    it('resets access/ranks and records pre-rebirth hall and inheritance values', async () => {
        const general = makeGeneral(generalIds[1]!, userIds[1]!);
        await db.generalAccessLog.create({
            data: { generalId: general.id, userId: general.userId, refreshScore: 77 },
        });
        await db.inheritancePoint.create({
            data: { userId: general.userId!, key: 'previous', value: 50 },
        });
        await db.rankData.create({
            data: { generalId: general.id, nationId: 0, type: 'warnum', value: 10 },
        });

        await db.$transaction((tx) =>
            persistGeneralLifecycleEvents(
                tx,
                [event(general, 'retired')],
                { serverId, season: 1, scenarioId: 2, isUnited: 0 },
                {}
            )
        );

        expect(await db.generalAccessLog.findUnique({ where: { generalId: general.id } })).toMatchObject({
            refreshScore: 0,
        });
        expect(await db.rankData.findUnique({ where: { generalId_type: { generalId: general.id, type: 'warnum' } } }))
            .toMatchObject({ value: 0 });
        expect(
            await db.hallOfFame.findUnique({
                where: {
                    serverId_type_generalNo: {
                        serverId,
                        type: 'experience',
                        generalNo: general.id,
                    },
                },
            })
        ).toMatchObject({ value: 1_000 });
        expect(
            await db.inheritancePoint.findUnique({
                where: { userId_key: { userId: general.userId!, key: 'previous' } },
            })
        ).toMatchObject({ value: 116 });
    });

    it('does not settle a possessed NPC before the legacy minimum possession period', async () => {
        const general = makeGeneral(generalIds[2]!, userIds[2]!, {
            npcState: 1,
            meta: {
                killturn: 0,
                inherit_lived_month: 10,
                inherit_active_action: 2,
                pickYearMonth: 190 * 12,
            },
        });
        await db.inheritancePoint.create({
            data: { userId: general.userId!, key: 'previous', value: 100 },
        });

        await db.$transaction((tx) =>
            persistGeneralLifecycleEvents(
                tx,
                [event(general, 'deleted')],
                { serverId, startYear: 180 },
                {}
            )
        );

        expect(
            await db.inheritancePoint.findUnique({
                where: { userId_key: { userId: general.userId!, key: 'previous' } },
            })
        ).toMatchObject({ value: 100 });
        expect(
            await db.inheritanceResult.count({
                where: { serverId, owner: general.userId! },
            })
        ).toBe(0);
    });
});
