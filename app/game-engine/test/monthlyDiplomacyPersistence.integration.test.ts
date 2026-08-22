import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import type { Nation } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createMonthlyDiplomacyHandler } from '../src/turn/monthlyNationStatsHandler.js';
import type { TurnDiplomacy, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const nationIds = [992_101, 992_102, 992_103, 992_104];
const scenarioCode = 'monthly-diplomacy-persistence';
const startLog =
    '<C>●</>193년 2월:<R><b>【개전】</b></><D><b>갑국</b></>과 <D><b>을국</b></>이 <R>전쟁</>을 시작합니다.';
const stopLog = '<C>●</>193년 4월:<R><b>【종전】</b></><D><b>병국</b></>과 <D><b>정국</b></>이 <S>종전</>합니다.';

const buildNation = (id: number, name: string, generalCount: number): Nation => ({
    id,
    name,
    color: '#777777',
    capitalCityId: null,
    chiefGeneralId: null,
    gold: 0,
    rice: 0,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: { gennum: generalCount },
});

const diplomacy: TurnDiplomacy[] = [
    { fromNationId: nationIds[0]!, toNationId: nationIds[1]!, state: 1, term: 1, dead: 777, meta: {} },
    { fromNationId: nationIds[1]!, toNationId: nationIds[0]!, state: 1, term: 1, dead: 888, meta: {} },
    { fromNationId: nationIds[0]!, toNationId: nationIds[2]!, state: 0, term: 5, dead: 250, meta: {} },
    { fromNationId: nationIds[2]!, toNationId: nationIds[0]!, state: 0, term: 5, dead: 50, meta: {} },
    { fromNationId: nationIds[2]!, toNationId: nationIds[3]!, state: 0, term: 1, dead: 0, meta: {} },
    { fromNationId: nationIds[3]!, toNationId: nationIds[2]!, state: 0, term: 3, dead: 0, meta: {} },
    { fromNationId: nationIds[1]!, toNationId: nationIds[3]!, state: 7, term: 1, dead: 999, meta: {} },
];

integration('monthly diplomacy persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.diplomacy.deleteMany({
            where: {
                OR: [{ srcNationId: { in: nationIds } }, { destNationId: { in: nationIds } }],
            },
        });
        await db.logEntry.deleteMany({ where: { text: { in: [startLog, stopLog] } } });
        await db.nation.deleteMany({ where: { id: { in: nationIds } } });
        await db.worldState.deleteMany({ where: { scenarioCode } });
    });

    afterAll(async () => {
        await db.diplomacy.deleteMany({
            where: {
                OR: [{ srcNationId: { in: nationIds } }, { destNationId: { in: nationIds } }],
            },
        });
        await db.logEntry.deleteMany({ where: { text: { in: [startLog, stopLog] } } });
        await db.nation.deleteMany({ where: { id: { in: nationIds } } });
        await db.worldState.deleteMany({ where: { scenarioCode } });
        await closeDb?.();
    });

    it('commits a shared war countdown and the exact transition history together', async () => {
        const nations = [
            buildNation(nationIds[0]!, '갑국', 2),
            buildNation(nationIds[1]!, '을국', 1),
            buildNation(nationIds[2]!, '병국', 1),
            buildNation(nationIds[3]!, '정국', 1),
        ];
        await db.nation.createMany({
            data: nations.map((nation) => ({
                id: nation.id,
                name: nation.name,
                color: nation.color,
                gold: 0,
                rice: 0,
                tech: 0,
                level: 1,
                typeCode: nation.typeCode,
                meta: nation.meta,
            })),
        });
        await db.diplomacy.createMany({
            data: diplomacy.map((entry) => ({
                srcNationId: entry.fromNationId,
                destNationId: entry.toNationId,
                stateCode: entry.state,
                term: entry.term,
                meta: { dead: entry.dead },
            })),
        });
        const worldRow = await db.worldState.create({
            data: {
                scenarioCode,
                currentYear: 193,
                currentMonth: 1,
                tickSeconds: 600,
                config: {
                    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                    iconPath: '',
                    map: {},
                    const: {},
                    environment: { mapName: 'test', unitSet: 'default' },
                },
                meta: {},
            },
        });
        const state: TurnWorldState = {
            id: worldRow.id,
            currentYear: 193,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0193-01-01T00:00:00.000Z'),
            meta: {},
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: { id: 'test', name: 'test', cities: [] },
            diplomacy,
            events: [],
            initialEvents: [],
            generals: [],
            cities: [],
            nations,
            troops: [],
        };
        let world: InMemoryTurnWorld | null = null;
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            autoAdvanceDiplomacyMonth: false,
            calendarHandler: createMonthlyDiplomacyHandler({ getWorld: () => world }),
        });
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            await world.advanceMonth(new Date('0193-02-01T00:00:00.000Z'));
            await hooks.hooks.flushChanges?.({
                lastTurnTime: '0193-02-01T00:00:00.000Z',
                processedGenerals: 0,
                processedTurns: 0,
                durationMs: 0,
                partial: false,
            });
            await world.advanceMonth(new Date('0193-03-01T00:00:00.000Z'));
            await hooks.hooks.flushChanges?.({
                lastTurnTime: '0193-03-01T00:00:00.000Z',
                processedGenerals: 0,
                processedTurns: 0,
                durationMs: 0,
                partial: false,
            });
            await world.advanceMonth(new Date('0193-04-01T00:00:00.000Z'));
            await hooks.hooks.flushChanges?.({
                lastTurnTime: '0193-04-01T00:00:00.000Z',
                processedGenerals: 0,
                processedTurns: 0,
                durationMs: 0,
                partial: false,
            });

            const rows = await db.diplomacy.findMany({
                where: {
                    OR: [{ srcNationId: { in: nationIds } }, { destNationId: { in: nationIds } }],
                },
                orderBy: [{ srcNationId: 'asc' }, { destNationId: 'asc' }],
            });
            expect(
                rows
                    .filter((row) =>
                        diplomacy.some(
                            (entry) => entry.fromNationId === row.srcNationId && entry.toNationId === row.destNationId
                        )
                    )
                    .map((row) => ({
                        fromNationId: row.srcNationId,
                        toNationId: row.destNationId,
                        state: row.stateCode,
                        term: row.term,
                        dead: (row.meta as { dead?: number }).dead ?? 0,
                    }))
            ).toEqual([
                { fromNationId: nationIds[0], toNationId: nationIds[1], state: 0, term: 4, dead: 0 },
                { fromNationId: nationIds[0], toNationId: nationIds[2], state: 0, term: 3, dead: 50 },
                { fromNationId: nationIds[1], toNationId: nationIds[0], state: 0, term: 4, dead: 0 },
                { fromNationId: nationIds[1], toNationId: nationIds[3], state: 2, term: 0, dead: 0 },
                { fromNationId: nationIds[2], toNationId: nationIds[0], state: 0, term: 3, dead: 50 },
                { fromNationId: nationIds[2], toNationId: nationIds[3], state: 2, term: 0, dead: 0 },
                { fromNationId: nationIds[3], toNationId: nationIds[2], state: 2, term: 0, dead: 0 },
            ]);
            expect(
                await db.logEntry.findMany({
                    where: { text: { in: [startLog, stopLog] } },
                    orderBy: { id: 'asc' },
                    select: { scope: true, category: true, year: true, month: true, text: true },
                })
            ).toEqual([
                { scope: 'SYSTEM', category: 'HISTORY', year: 193, month: 2, text: startLog },
                { scope: 'SYSTEM', category: 'HISTORY', year: 193, month: 4, text: stopLog },
            ]);
            expect(await db.worldState.findUniqueOrThrow({ where: { id: worldRow.id } })).toMatchObject({
                currentYear: 193,
                currentMonth: 4,
            });
        } finally {
            await hooks.close();
        }
    });
});
