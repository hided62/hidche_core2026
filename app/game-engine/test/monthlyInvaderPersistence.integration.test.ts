import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import type { City, Nation } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import {
    createAutoDeleteInvaderHandler,
    createInvaderEndingHandler,
    createRaiseInvaderHandler,
} from '../src/turn/monthlyInvaderAction.js';
import { createMonthlyEventHandler } from '../src/turn/monthlyEventHandler.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const existingNationId = 991_100;
const createdNationId = 991_101;
const existingGeneralId = 991_100;
const firstCreatedGeneralId = 991_101;
const ordinaryCityId = 991_100;
const invaderCityId = 991_101;
const sourceEventId = 991_100;
const createdEventIds = [991_101, 991_102];
const serverId = 'raise-invader-persistence';

type ReferenceInvaderLifecycleTrace = {
    phases: {
        afterRaise: {
            createdNationCount: number;
            generalCountsPerNation: number[];
            diplomacyCountsPerNation: number[];
            diplomacyStates: string[];
            isunited: number;
            blockChangeScout: boolean;
        };
        atWar: { results: string[]; autoDeleteEventCount: number };
        atPeace: {
            results: string[];
            autoDeleteEventCount: number;
            rulerWanderTurnCount: number;
            endingEventPresent: boolean;
        };
        afterUserWin: {
            result: string;
            endingEventPresent: boolean;
            isunited: number;
            refreshLimit: number;
            logs: string[];
        };
    };
};

const runReferenceInvaderLifecycle = (): ReferenceInvaderLifecycleTrace | null => {
    const workspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT;
    if (process.env.TURN_DIFFERENTIAL_REFERENCE !== '1' || !workspaceRoot) {
        return null;
    }
    const stackDirectory = path.join(workspaceRoot, 'docker_compose_files/reference');
    const runnerScript =
        process.env.MONTHLY_INVADER_LIFECYCLE_RUNNER_SCRIPT ??
        path.join(workspaceRoot, 'ref/sam/hwe/compare/monthly_event_trace.php');
    const fixturePath =
        process.env.MONTHLY_INVADER_LIFECYCLE_FIXTURE ??
        path.join(path.dirname(runnerScript), 'fixtures/monthly_invader_lifecycle.json');
    const stdout = execFileSync('./scripts/run-turn-differential-case.sh', ['-'], {
        cwd: stackDirectory,
        input: fs.readFileSync(fixturePath, 'utf8'),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
            ...process.env,
            COMPOSE_PROJECT_NAME: 'sam-rebuild-reference',
            TURN_DIFFERENTIAL_RUNNER_SCRIPT: runnerScript,
            TURN_DIFFERENTIAL_COMPARE_DIR: path.dirname(runnerScript),
        },
    });
    return JSON.parse(stdout) as ReferenceInvaderLifecycleTrace;
};

const buildCity = (id: number, nationId: number, level: number, name: string): City => ({
    id,
    name,
    nationId,
    level,
    state: 0,
    population: 1_000,
    populationMax: 10_000,
    agriculture: 2_000,
    agricultureMax: 20_000,
    commerce: 3_000,
    commerceMax: 30_000,
    security: 4_000,
    securityMax: 40_000,
    supplyState: 1,
    frontState: 0,
    defence: 5_000,
    defenceMax: 50_000,
    wall: 6_000,
    wallMax: 60_000,
    meta: { trust: 50, region: 1 },
});

const ordinaryCity = buildCity(ordinaryCityId, existingNationId, 3, '기준도시');
const invaderCity = buildCity(invaderCityId, 0, 4, '남만');
const neutralNation: Nation = {
    id: 0,
    name: '재야',
    color: '#000000',
    capitalCityId: null,
    chiefGeneralId: null,
    gold: 0,
    rice: 0,
    power: 0,
    level: 0,
    typeCode: 'che_중립',
    meta: {},
};
const existingNation: Nation = {
    id: existingNationId,
    name: '기준국',
    color: '#777777',
    capitalCityId: ordinaryCityId,
    chiefGeneralId: existingGeneralId,
    gold: 1_000,
    rice: 1_000,
    power: 0,
    level: 2,
    typeCode: 'che_유가',
    meta: { tech: 100, war: 1, scout: 1 },
};
const existingGeneral: TurnGeneral = {
    id: existingGeneralId,
    userId: null,
    name: '군주',
    nationId: existingNationId,
    cityId: ordinaryCityId,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 1_000,
    dedication: 1_000,
    officerLevel: 12,
    role: {
        personality: 'che_안전',
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 1100,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
    bornYear: 170,
    deadYear: 250,
    affinity: 1,
    picture: 'default.jpg',
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    lastTurn: { command: '휴식' },
    turnTime: new Date('0200-01-01T00:05:00.000Z'),
    recentWarTime: null,
    meta: { killturn: 1_000, dex1: 10, dex2: 20, dex3: 30, dex4: 40, dex5: 50 },
};
const sourceEvent: TurnEvent = {
    id: sourceEventId,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['RaiseInvader', 10, 150, 100, 20]],
    meta: {},
};

integration('RaiseInvader database persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const clean = async () => {
        const createdGeneralIds = Array.from({ length: 10 }, (_, index) => firstCreatedGeneralId + index);
        await db.unificationFinalization.deleteMany({ where: { serverId } });
        await db.yearbookHistory.deleteMany({ where: { profileName: serverId } });
        await db.hallOfFame.deleteMany({ where: { serverId } });
        await db.emperor.deleteMany({ where: { serverId } });
        await db.gameHistory.deleteMany({ where: { serverId } });
        await db.logEntry.deleteMany({
            where: { year: 200, text: { contains: '【이벤트】' } },
        });
        await db.generalTurn.deleteMany({
            where: { generalId: { in: [existingGeneralId, ...createdGeneralIds] } },
        });
        await db.rankData.deleteMany({
            where: { generalId: { in: [existingGeneralId, ...createdGeneralIds] } },
        });
        await db.general.deleteMany({
            where: { id: { in: [existingGeneralId, ...createdGeneralIds] } },
        });
        await db.nationTurn.deleteMany({ where: { nationId: createdNationId } });
        await db.diplomacy.deleteMany({
            where: {
                OR: [
                    { srcNationId: { in: [existingNationId, createdNationId] } },
                    { destNationId: { in: [existingNationId, createdNationId] } },
                ],
            },
        });
        await db.nation.deleteMany({
            where: { id: { in: [neutralNation.id, existingNationId, createdNationId] } },
        });
        await db.city.deleteMany({ where: { id: { in: [ordinaryCityId, invaderCityId] } } });
        await db.event.deleteMany({ where: { id: { in: [sourceEventId, ...createdEventIds] } } });
        await db.worldState.deleteMany({ where: { scenarioCode: 'monthly-invader-persistence' } });
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

    it('commits invader entities, dynamic events, diplomacy, turns, ranks, city state, and logs atomically', async () => {
        const referenceTrace = runReferenceInvaderLifecycle();
        const createdGeneralIds = Array.from({ length: 10 }, (_, index) => firstCreatedGeneralId + index);
        const createCity = (city: City) =>
            db.city.create({
                data: {
                    id: city.id,
                    name: city.name,
                    nationId: city.nationId,
                    level: city.level,
                    supplyState: city.supplyState,
                    frontState: city.frontState,
                    population: city.population,
                    populationMax: city.populationMax,
                    agriculture: city.agriculture,
                    agricultureMax: city.agricultureMax,
                    commerce: city.commerce,
                    commerceMax: city.commerceMax,
                    security: city.security,
                    securityMax: city.securityMax,
                    trust: 50,
                    trade: 100,
                    defence: city.defence,
                    defenceMax: city.defenceMax,
                    wall: city.wall,
                    wallMax: city.wallMax,
                    region: 1,
                    conflict: {},
                    meta: {},
                },
            });
        await createCity(ordinaryCity);
        await createCity(invaderCity);
        await db.nation.create({
            data: {
                id: neutralNation.id,
                name: neutralNation.name,
                color: neutralNation.color,
                capitalCityId: neutralNation.capitalCityId,
                chiefGeneralId: neutralNation.chiefGeneralId,
                gold: neutralNation.gold,
                rice: neutralNation.rice,
                tech: 0,
                level: neutralNation.level,
                typeCode: neutralNation.typeCode,
                meta: neutralNation.meta,
            },
        });
        await db.nation.create({
            data: {
                id: existingNationId,
                name: existingNation.name,
                color: existingNation.color,
                capitalCityId: ordinaryCityId,
                chiefGeneralId: existingGeneralId,
                gold: existingNation.gold,
                rice: existingNation.rice,
                tech: 100,
                level: 2,
                typeCode: existingNation.typeCode,
                meta: existingNation.meta,
            },
        });
        await db.general.create({
            data: {
                id: existingGeneralId,
                name: existingGeneral.name,
                nationId: existingNationId,
                cityId: ordinaryCityId,
                leadership: 50,
                strength: 50,
                intel: 50,
                experience: 1_000,
                dedication: 1_000,
                officerLevel: 12,
                gold: 1_000,
                rice: 1_000,
                crewTypeId: 1100,
                age: 30,
                npcState: 0,
                bornYear: 170,
                deadYear: 250,
                affinity: 1,
                personalCode: 'che_안전',
                lastTurn: { command: '휴식' },
                meta: existingGeneral.meta,
                turnTime: existingGeneral.turnTime,
            },
        });
        await db.event.create({
            data: {
                id: sourceEventId,
                targetCode: 'month',
                priority: 1_000,
                condition: true,
                action: [['RaiseInvader', 10, 150, 100, 20]],
                meta: {},
            },
        });
        const stateRow = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-invader-persistence',
                currentYear: 199,
                currentMonth: 12,
                tickSeconds: 600,
                config: {},
                meta: {
                    hiddenSeed: serverId,
                    lastGeneralId: firstCreatedGeneralId - 1,
                    lastNationId: createdNationId - 1,
                    serverId,
                    refreshLimit: 3,
                },
            },
        });
        const state: TurnWorldState = {
            id: stateRow.id,
            currentYear: 199,
            currentMonth: 12,
            tickSeconds: 600,
            lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
            meta: {
                hiddenSeed: serverId,
                lastGeneralId: firstCreatedGeneralId - 1,
                lastNationId: createdNationId - 1,
                serverId,
                refreshLimit: 3,
            },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
                iconPath: '.',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: { id: 'test', name: 'test', cities: [] },
            generals: [existingGeneral],
            cities: [ordinaryCity, invaderCity],
            nations: [neutralNation, existingNation],
            troops: [],
            diplomacy: [],
            events: [sourceEvent],
            initialEvents: [],
        };
        const reservedTurns = new InMemoryReservedTurnStore(db, { maxGeneralTurns: 30, maxNationTurns: 12 });
        let world: InMemoryTurnWorld | null = null;
        const handler = createRaiseInvaderHandler({
            getWorld: () => world,
            reservedTurns,
            env: buildCommandEnv(snapshot.scenarioConfig),
            loadArchivedNationMaxId: async () => 0,
        });
        const autoDelete = createAutoDeleteInvaderHandler({
            getWorld: () => world,
            reservedTurns,
        });
        const ending = createInvaderEndingHandler({ getWorld: () => world });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createMonthlyEventHandler({
                getWorld: () => world,
                startYear: 190,
                actions: new Map([
                    ['RaiseInvader', handler],
                    ['AutoDeleteInvader', autoDelete],
                    ['InvaderEnding', ending],
                ]),
            }),
        });
        const dbHooks = await createDatabaseTurnHooks(databaseUrl!, world, { reservedTurns });

        try {
            await world.advanceMonth(new Date('0200-01-01T00:00:00.000Z'));
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.nation.findUniqueOrThrow({ where: { id: createdNationId } })).toMatchObject({
                name: 'ⓞ남만족',
                capitalCityId: invaderCityId,
                chiefGeneralId: firstCreatedGeneralId,
                gold: 9_999_999,
                rice: 9_999_999,
                tech: 100,
                level: 2,
                typeCode: 'che_병가',
            });
            expect(await db.general.count({ where: { nationId: createdNationId } })).toBe(10);
            expect(await db.generalTurn.count({ where: { generalId: { in: createdGeneralIds } } })).toBe(300);
            expect(await db.rankData.count({ where: { generalId: { in: createdGeneralIds } } })).toBe(440);
            expect(await db.nationTurn.count({ where: { nationId: createdNationId } })).toBe(48);
            expect(
                await db.diplomacy.count({
                    where: {
                        OR: [{ srcNationId: createdNationId }, { destNationId: createdNationId }],
                    },
                })
            ).toBe(4);
            expect(
                await db.diplomacy.findMany({
                    where: {
                        OR: [
                            { srcNationId: neutralNation.id, destNationId: createdNationId },
                            { srcNationId: createdNationId, destNationId: neutralNation.id },
                        ],
                    },
                    orderBy: [{ srcNationId: 'asc' }, { destNationId: 'asc' }],
                    select: { srcNationId: true, destNationId: true, stateCode: true, term: true },
                })
            ).toEqual([
                { srcNationId: neutralNation.id, destNationId: createdNationId, stateCode: 2, term: 0 },
                { srcNationId: createdNationId, destNationId: neutralNation.id, stateCode: 2, term: 0 },
            ]);
            expect(
                await db.event.findMany({
                    where: { id: { in: createdEventIds } },
                    orderBy: { id: 'asc' },
                    select: { id: true, targetCode: true, priority: true, condition: true, action: true },
                })
            ).toEqual([
                {
                    id: createdEventIds[0],
                    targetCode: 'month',
                    priority: 1_000,
                    condition: true,
                    action: [['AutoDeleteInvader', createdNationId]],
                },
                {
                    id: createdEventIds[1],
                    targetCode: 'month',
                    priority: 1_000,
                    condition: true,
                    action: [['InvaderEnding']],
                },
            ]);
            expect(await db.city.findUniqueOrThrow({ where: { id: invaderCityId } })).toMatchObject({
                nationId: createdNationId,
                population: 200_000,
                populationMax: 200_000,
                agriculture: 20_000,
                commerce: 30_000,
                security: 40_000,
                defenceMax: 100_000,
                wallMax: 10_000,
            });
            expect(await db.general.findUniqueOrThrow({ where: { id: existingGeneralId } })).toMatchObject({
                gold: 999_999,
                rice: 999_999,
            });
            expect(
                await db.logEntry.count({
                    where: { year: 200, month: 1, text: { contains: '【이벤트】' } },
                })
            ).toBe(3);
            expect(await db.worldState.findUniqueOrThrow({ where: { id: stateRow.id } })).toMatchObject({
                meta: expect.objectContaining({ isunited: 1, isUnited: 1, block_change_scout: false }),
            });
            if (referenceTrace) {
                expect(referenceTrace.phases.afterRaise).toMatchObject({
                    generalCountsPerNation: [10],
                    diplomacyCountsPerNation: [2],
                    diplomacyStates: ['1:24'],
                    isunited: 1,
                    blockChangeScout: false,
                });
            }
            const sequenceProbe = await db.event.create({
                data: {
                    targetCode: 'month',
                    priority: 0,
                    condition: false,
                    action: [],
                    meta: {},
                },
            });
            expect(sequenceProbe.id).toBeGreaterThan(createdEventIds[1]!);
            await db.event.delete({ where: { id: sequenceProbe.id } });

            expect(world.removeEvent(sourceEventId)).toBe(true);
            await world.advanceMonth(new Date('0200-02-01T00:00:00.000Z'));
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: world.getState().lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.event.findUnique({ where: { id: createdEventIds[0]! } })).not.toBeNull();
            if (referenceTrace) {
                expect(referenceTrace.phases.atWar).toEqual({
                    results: ['On War'],
                    autoDeleteEventCount: referenceTrace.phases.afterRaise.createdNationCount,
                });
            }

            world.applyDiplomacyPatch({
                srcNationId: createdNationId,
                destNationId: existingNationId,
                patch: { state: 2, term: 0 },
            });
            world.applyDiplomacyPatch({
                srcNationId: existingNationId,
                destNationId: createdNationId,
                patch: { state: 2, term: 0 },
            });
            await world.advanceMonth(new Date('0200-03-01T00:00:00.000Z'));
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: world.getState().lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.event.findUnique({ where: { id: createdEventIds[0]! } })).toBeNull();
            expect(
                await db.generalTurn.findMany({
                    where: { generalId: firstCreatedGeneralId },
                    select: { actionCode: true },
                })
            ).toEqual(Array.from({ length: 30 }, () => ({ actionCode: 'che_방랑' })));
            expect(await db.event.findUnique({ where: { id: createdEventIds[1]! } })).not.toBeNull();
            if (referenceTrace) {
                expect(referenceTrace.phases.atPeace).toMatchObject({
                    results: ['Deleted'],
                    autoDeleteEventCount: 0,
                    endingEventPresent: true,
                });
                expect(
                    referenceTrace.phases.atPeace.rulerWanderTurnCount /
                        referenceTrace.phases.afterRaise.createdNationCount
                ).toBe(30);
            }

            await reservedTurns.prepareTurnsForExecution(firstCreatedGeneralId, {
                nationId: createdNationId,
                officerLevel: 12,
            });
            reservedTurns.shiftGeneralTurns(firstCreatedGeneralId, -1);
            reservedTurns.shiftNationTurns(createdNationId, 12, -1);
            for (const generalId of createdGeneralIds) {
                expect(world.removeGeneral(generalId)).toBe(true);
            }
            expect(world.removeNation(createdNationId)).toBe(true);
            world.updateCity(invaderCityId, { nationId: existingNationId });
            await world.advanceMonth(new Date('0200-04-01T00:00:00.000Z'));
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: world.getState().lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.event.findUnique({ where: { id: createdEventIds[1]! } })).toBeNull();
            expect(await db.generalTurnRevision.findUnique({ where: { generalId: firstCreatedGeneralId } })).toBeNull();
            expect(
                await db.nationTurnRevision.findUnique({
                    where: {
                        nationId_officerLevel: { nationId: createdNationId, officerLevel: 12 },
                    },
                })
            ).toBeNull();
            expect(reservedTurns.inspectState()).toMatchObject({
                dirtyGeneralIds: [],
                dirtyNationKeys: [],
                leasedGeneralIds: [],
                leasedNationKeys: [],
            });
            expect(await db.worldState.findUniqueOrThrow({ where: { id: stateRow.id } })).toMatchObject({
                meta: expect.objectContaining({ isunited: 3, isUnited: 3, refreshLimit: 300 }),
            });
            expect(
                await db.logEntry.findMany({
                    where: { year: 200, month: 4, text: { contains: '【이벤트】' } },
                    orderBy: { id: 'asc' },
                    select: { text: true },
                })
            ).toEqual([
                { text: '<C>●</>200년 4월:<L><b>【이벤트】</b></>이민족을 모두 소탕했습니다!' },
                { text: '<C>●</>200년 4월:<L><b>【이벤트】</b></>중원은 당분간 태평성대를 누릴 것입니다.' },
            ]);
            await expect(db.unificationFinalization.count({ where: { serverId } })).resolves.toBe(0);
            await expect(db.yearbookHistory.count({ where: { profileName: serverId } })).resolves.toBe(0);
            await expect(db.hallOfFame.count({ where: { serverId } })).resolves.toBe(0);
            await expect(db.emperor.count({ where: { serverId } })).resolves.toBe(0);
            await expect(db.gameHistory.count({ where: { serverId } })).resolves.toBe(0);
            if (referenceTrace) {
                expect(referenceTrace.phases.afterUserWin).toEqual({
                    result: 'Deleted',
                    endingEventPresent: false,
                    isunited: 3,
                    refreshLimit: 300,
                    logs: [
                        '<C>●</>200년 4월:<L><b>【이벤트】</b></>이민족을 모두 소탕했습니다!',
                        '<C>●</>200년 4월:<L><b>【이벤트】</b></>중원은 당분간 태평성대를 누릴 것입니다.',
                    ],
                });
            }
        } finally {
            await dbHooks.close();
        }
    }, 30_000);
});
