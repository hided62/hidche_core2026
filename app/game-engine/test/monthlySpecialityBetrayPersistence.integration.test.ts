import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Nation } from '@sammo-ts/logic';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createMonthlyEventHandler } from '../src/turn/monthlyEventHandler.js';
import {
    createAddGlobalBetrayHandler,
    createAssignGeneralSpecialityHandler,
} from '../src/turn/monthlySpecialityBetrayAction.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const nationId = 990_091;
const generalIds = [990_091, 990_092] as const;

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 9_000,
    condition: true,
    action: [['AssignGeneralSpeciality'], ['AddGlobalBetray', 2, 1]],
    meta: {},
};

const nation: Nation = {
    id: nationId,
    name: '특기검증국',
    color: '#777777',
    capitalCityId: null,
    chiefGeneralId: null,
    gold: 0,
    rice: 0,
    power: 0,
    level: 2,
    typeCode: 'che_중립',
    meta: {},
};

const buildGeneral = (
    id: number,
    options: { domestic: string | null; war: string | null; meta: Record<string, unknown> }
): TurnGeneral => ({
    id,
    userId: null,
    name: id === generalIds[0] ? '영속내정대상' : '영속계승대상',
    nationId,
    cityId: 0,
    troopId: 0,
    stats: { leadership: 40, strength: 45, intelligence: 80 },
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: options.domestic,
        specialWar: options.war,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    startAge: 20,
    npcState: 2,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { ...options.meta, killturn: 24 },
    lastTurn: { command: '휴식' },
    turnTime: new Date('2026-07-25T00:00:00.000Z'),
});

integration('monthly speciality and betrayal persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.logEntry.deleteMany({ where: { generalId: { in: [...generalIds] } } });
        await db.general.deleteMany({ where: { id: { in: [...generalIds] } } });
        await db.nation.deleteMany({ where: { id: nationId } });
    });

    afterAll(async () => {
        await db.logEntry.deleteMany({ where: { generalId: { in: [...generalIds] } } });
        await db.general.deleteMany({ where: { id: { in: [...generalIds] } } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await closeDb?.();
    });

    it('flushes trait columns, inherited aux removal, betrayal, and four general logs', async () => {
        const generals = [
            buildGeneral(generalIds[0], {
                domestic: null,
                war: 'che_신산',
                meta: { specage: 30, specage2: 99, betray: 0 },
            }),
            buildGeneral(generalIds[1], {
                domestic: 'che_경작',
                war: null,
                meta: {
                    specage: 99,
                    specage2: 30,
                    betray: 1,
                    inheritSpecificSpecialWar: 'che_의술',
                    marker: 2,
                },
            }),
        ];
        await db.nation.create({
            data: {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                level: nation.level,
                typeCode: nation.typeCode,
                meta: {},
            },
        });
        await db.general.createMany({
            data: generals.map((general) => ({
                id: general.id,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                leadership: general.stats.leadership,
                strength: general.stats.strength,
                intel: general.stats.intelligence,
                age: general.age,
                startAge: general.startAge,
                specialCode: general.role.specialDomestic ?? 'None',
                special2Code: general.role.specialWar ?? 'None',
                turnTime: general.turnTime,
                meta: general.meta,
            })),
        });
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-speciality-betray-persistence',
                currentYear: 199,
                currentMonth: 12,
                tickSeconds: 600,
                config: {},
                meta: { hiddenSeed: 'monthly-speciality-persistence' },
            },
        });
        const state: TurnWorldState = {
            id: row.id,
            currentYear: 199,
            currentMonth: 12,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-07-25T00:00:00.000Z'),
            meta: { hiddenSeed: 'monthly-speciality-persistence' },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
                iconPath: '.',
                map: {},
                const: {
                    defaultSpecialDomestic: 'None',
                    defaultSpecialWar: 'None',
                    retirementYear: 80,
                },
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: { id: 'test', name: 'test', cities: [] },
            generals,
            cities: [],
            nations: [nation],
            troops: [],
            diplomacy: [],
            events: [event],
            initialEvents: [],
        };
        let world: InMemoryTurnWorld | null = null;
        const assign = createAssignGeneralSpecialityHandler({ getWorld: () => world });
        const betray = createAddGlobalBetrayHandler({ getWorld: () => world });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createMonthlyEventHandler({
                getWorld: () => world,
                startYear: 190,
                actions: new Map([
                    ['AssignGeneralSpeciality', assign],
                    ['AddGlobalBetray', betray],
                ]),
            }),
        });
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);

        try {
            await world.advanceMonth(new Date('0200-01-01T00:00:00.000Z'));
            await hooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 2,
                durationMs: 0,
                partial: false,
            });

            const rows = await db.general.findMany({
                where: { id: { in: [...generalIds] } },
                orderBy: { id: 'asc' },
            });
            expect(rows[0]?.specialCode).not.toBe('None');
            expect(rows[0]?.meta).toMatchObject({ betray: 2 });
            expect(rows[1]).toMatchObject({ special2Code: 'che_의술' });
            expect(rows[1]?.meta).toMatchObject({ betray: 3, marker: 2 });
            expect(rows[1]?.meta).not.toHaveProperty('inheritSpecificSpecialWar');
            expect(await db.logEntry.count({ where: { generalId: { in: [...generalIds] } } })).toBe(4);
        } finally {
            await hooks.close();
            await db.worldState.deleteMany({ where: { id: row.id } });
        }
    });
});
