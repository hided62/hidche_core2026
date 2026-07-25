import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createTurnDaemonRuntime } from '../src/turn/turnDaemon.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const profile = 'monthly-catalog-boundary';
const eventIds = [991_001, 991_002] as const;

const scenarioConfig = {
    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
    iconPath: '.',
    map: {},
    const: {},
    environment: { mapName: 'che', unitSet: 'che' },
};

integration('monthly catalog boundary persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const clean = async () => {
        await db.logEntry.deleteMany({});
        await db.yearbookHistory.deleteMany({});
        await db.generalTurn.deleteMany({});
        await db.nationTurn.deleteMany({});
        await db.rankData.deleteMany({});
        await db.generalAccessLog.deleteMany({});
        await db.diplomacy.deleteMany({});
        await db.event.deleteMany({});
        await db.general.deleteMany({});
        await db.nation.deleteMany({});
        await db.city.deleteMany({});
        await db.worldState.deleteMany({});
        await db.turnDaemonLease.deleteMany({ where: { profile } });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await clean();
    });

    afterAll(async () => {
        await clean();
        await closeDb?.();
    });

    it('matches the ref PRE_MONTH, month actions, and post-month projection in one daemon boundary', async () => {
        await db.city.createMany({
            data: [
                {
                    id: 1,
                    name: '경계도시',
                    nationId: 1,
                    level: 1,
                    supplyState: 1,
                    frontState: 2,
                    population: 10_000,
                    populationMax: 20_000,
                    agriculture: 1_000,
                    agricultureMax: 2_000,
                    commerce: 1_000,
                    commerceMax: 2_000,
                    security: 1_000,
                    securityMax: 2_000,
                    trust: 50,
                    trade: 100,
                    defence: 1_000,
                    defenceMax: 2_000,
                    wall: 1_000,
                    wallMax: 2_000,
                    region: 1,
                    conflict: {},
                    meta: { state: 31, term: 1, officer_set: 1 },
                },
                {
                    id: 2,
                    name: '중립도시',
                    nationId: 0,
                    level: 8,
                    supplyState: 0,
                    frontState: 0,
                    population: 12_000,
                    populationMax: 22_000,
                    agriculture: 1_200,
                    agricultureMax: 2_200,
                    commerce: 1_200,
                    commerceMax: 2_200,
                    security: 1_200,
                    securityMax: 2_200,
                    trust: 55,
                    trade: 100,
                    defence: 1_200,
                    defenceMax: 2_200,
                    wall: 1_200,
                    wallMax: 2_200,
                    region: 1,
                    conflict: {},
                    meta: { state: 0, term: 0, officer_set: 1 },
                },
            ],
        });
        await db.nation.create({
            data: {
                id: 1,
                name: '경계국',
                color: '#123456',
                capitalCityId: 1,
                chiefGeneralId: 1,
                gold: 10_000,
                rice: 20_000,
                tech: 100,
                level: 2,
                typeCode: 'che_유가',
                meta: {
                    power: 10,
                    gennum: 1,
                    bill: 100,
                    rate: 20,
                    rate_tmp: 10,
                    scout: 1,
                    chief_set: 1,
                    strategic_cmd_limit: 2,
                    surlimit: 1,
                    spy: {},
                },
            },
        });
        await db.general.createMany({
            data: [
                {
                    id: 1,
                    name: '경계군주',
                    nationId: 1,
                    cityId: 1,
                    officerLevel: 12,
                    npcState: 0,
                    leadership: 50,
                    strength: 50,
                    intel: 50,
                    age: 30,
                    bornYear: 160,
                    deadYear: 250,
                    gold: 1_000,
                    rice: 1_000,
                    crew: 100,
                    crewTypeId: 1100,
                    train: 80,
                    atmos: 70,
                    turnTime: new Date('2026-07-25T01:50:00.000Z'),
                    meta: { belong: 3, makelimit: 2, killturn: 0 },
                },
                {
                    id: 2,
                    name: '경계재야',
                    nationId: 0,
                    cityId: 2,
                    officerLevel: 0,
                    npcState: 0,
                    leadership: 40,
                    strength: 40,
                    intel: 40,
                    age: 25,
                    bornYear: 165,
                    deadYear: 250,
                    gold: 500,
                    rice: 500,
                    crew: 50,
                    crewTypeId: 1100,
                    train: 60,
                    atmos: 50,
                    turnTime: new Date('2026-07-25T01:50:00.000Z'),
                    meta: { belong: 4, makelimit: 0, killturn: 0 },
                },
            ],
        });
        await db.generalTurn.createMany({
            data: [1, 2].flatMap((generalId) =>
                Array.from({ length: 30 }, (_, turnIdx) => ({
                    generalId,
                    turnIdx,
                    actionCode: '휴식',
                    arg: {},
                }))
            ),
        });
        await db.event.createMany({
            data: [
                {
                    id: eventIds[0],
                    targetCode: 'PRE_MONTH',
                    priority: 1_000,
                    condition: true,
                    action: [['NoticeToHistoryLog', 'aggregate-pre', 6]],
                    meta: {},
                },
                {
                    id: eventIds[1],
                    targetCode: 'MONTH',
                    priority: 1_000,
                    condition: true,
                    action: [
                        ['ProcessIncome', 'gold'],
                        ['NewYear'],
                        ['ResetOfficerLock'],
                        ['RandomizeCityTradeRate'],
                        ['ChangeCity', 'all', { pop: '+10', trust: 60 }],
                        ['NoticeToHistoryLog', 'aggregate-month', 6],
                        ['DeleteEvent'],
                    ],
                    meta: {},
                },
            ],
        });
        await db.worldState.create({
            data: {
                scenarioCode: profile,
                currentYear: 190,
                currentMonth: 12,
                tickSeconds: 600,
                config: scenarioConfig,
                meta: {
                    hiddenSeed: 'monthly-boundary-core-catalog',
                    lastTurnTime: '2026-07-25T01:50:00.000Z',
                    isunited: 1,
                    refreshLimit: 3,
                    block_change_scout: false,
                    develcost: 18,
                    scenarioMeta: {
                        title: 'monthly catalog boundary',
                        startYear: 190,
                        life: null,
                        fiction: null,
                        history: [],
                        ignoreDefaultEvents: false,
                    },
                },
            },
        });

        const runtime = await createTurnDaemonRuntime({
            profile,
            databaseUrl: databaseUrl!,
            enableLeaseHeartbeat: false,
        });
        try {
            await runtime.world.advanceMonth(new Date('2026-07-25T02:00:00.000Z'));
            await runtime.hooks?.flushChanges?.({
                lastTurnTime: runtime.world.getState().lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.worldState.findFirstOrThrow()).toMatchObject({
                currentYear: 191,
                currentMonth: 1,
                meta: expect.objectContaining({ develcost: 20 }),
            });
            expect(
                await db.general.findMany({
                    orderBy: { id: 'asc' },
                    select: { id: true, age: true, gold: true, meta: true },
                })
            ).toEqual([
                { id: 1, age: 31, gold: 1_400, meta: expect.objectContaining({ belong: 4, makelimit: 1 }) },
                { id: 2, age: 26, gold: 500, meta: expect.objectContaining({ belong: 4, makelimit: 0 }) },
            ]);
            expect(
                await db.city.findMany({
                    orderBy: { id: 'asc' },
                    select: {
                        id: true,
                        population: true,
                        trust: true,
                        trade: true,
                        frontState: true,
                        meta: true,
                    },
                })
            ).toEqual([
                {
                    id: 1,
                    population: 10_010,
                    trust: 60,
                    trade: null,
                    frontState: 0,
                    meta: expect.objectContaining({ state: 0, term: 0, officer_set: 0 }),
                },
                {
                    id: 2,
                    population: 12_010,
                    trust: 60,
                    trade: 99,
                    frontState: 0,
                    meta: expect.objectContaining({ state: 0, term: 0, officer_set: 0 }),
                },
            ]);
            expect(await db.nation.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({
                gold: 9_753,
                rice: 20_000,
                meta: expect.objectContaining({
                    power: 68,
                    gennum: 1,
                    prev_income_gold: 153,
                    rate_tmp: 20,
                    strategic_cmd_limit: 1,
                    surlimit: 0,
                    chief_set: 0,
                }),
            });
            expect(
                await db.logEntry.findMany({
                    orderBy: { id: 'asc' },
                    select: { year: true, month: true, text: true },
                })
            ).toEqual([
                { year: 190, month: 12, text: '<S>◆</>190년 12월:aggregate-pre' },
                { year: 191, month: 1, text: '<C>●</>이번 수입은 금 <C>153</>입니다.' },
                { year: 191, month: 1, text: '<C>●</>봉급으로 금 <C>400</>을 받았습니다.' },
                {
                    year: 191,
                    month: 1,
                    text: '<C>●</>191년 1월:<W><b>【지급】</b></>봄이 되어 봉록에 따라 자금이 지급됩니다.',
                },
                { year: 191, month: 1, text: '<C>●</>1월:<C>191</>년이 되었습니다.' },
                { year: 191, month: 1, text: '<S>◆</>191년 1월:aggregate-month' },
            ]);
            expect(await db.event.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).toEqual([
                { id: eventIds[0] },
            ]);
        } finally {
            await runtime.close();
        }
    });
});
