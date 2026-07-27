import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import type { City, MapDefinition, Nation } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createProvideNpcTroopLeaderHandler } from '../src/turn/monthlyProvideNpcTroopLeaderAction.js';
import { createRaiseNpcNationHandler } from '../src/turn/monthlyRaiseNpcNationAction.js';
import { createMonthlyEventHandler } from '../src/turn/monthlyEventHandler.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnEvent, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const existingNationId = 990_083;
const createdNationId = 990_086;
const occupiedCityId = 990_083;
const targetCityId = 990_086;
const createdGeneralId = 990_086;
const existingNationLeaderId = 990_087;
const createdNationLeaderId = 990_088;
const createdGeneralIds = [createdGeneralId, existingNationLeaderId, createdNationLeaderId];

type ReferenceNpcNationLifecycleTrace = {
    phases: {
        afterRaise: {
            createdNationCount: number;
            createdGeneralCount: number;
            generalCountsPerCreatedNation: number[];
            historyLogs: string[];
        };
        afterProvide: {
            createdLeaderCount: number;
            leaderCountsPerActiveNation: number[];
            troopCount: number;
            gatherTurnCounts: number[];
            leaderCounterDelta: number;
        };
    };
};

const runReferenceNpcNationLifecycle = (): ReferenceNpcNationLifecycleTrace | null => {
    const workspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT;
    if (process.env.TURN_DIFFERENTIAL_REFERENCE !== '1' || !workspaceRoot) {
        return null;
    }
    const stackDirectory = path.join(workspaceRoot, 'docker_compose_files/reference');
    const runnerScript =
        process.env.MONTHLY_NPC_LIFECYCLE_RUNNER_SCRIPT ??
        path.join(workspaceRoot, 'ref/sam/hwe/compare/monthly_event_trace.php');
    const fixturePath =
        process.env.MONTHLY_NPC_LIFECYCLE_FIXTURE ??
        path.join(path.dirname(runnerScript), 'fixtures/monthly_npc_nation_lifecycle.json');
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
    return JSON.parse(stdout) as ReferenceNpcNationLifecycleTrace;
};

const buildCity = (id: number, nationId: number, name: string): City => ({
    id,
    name,
    nationId,
    level: 5,
    state: 0,
    population: 10_000,
    populationMax: 50_000,
    agriculture: 1_000,
    agricultureMax: 5_000,
    commerce: 2_000,
    commerceMax: 6_000,
    security: 3_000,
    securityMax: 7_000,
    supplyState: 1,
    frontState: 0,
    defence: 4_000,
    defenceMax: 8_000,
    wall: 5_000,
    wallMax: 9_000,
    meta: { trust: 50 },
});

const occupiedCity = buildCity(occupiedCityId, existingNationId, '기준도시');
const targetCity = buildCity(targetCityId, 0, 'NPC건국도시');
const existingNation: Nation = {
    id: existingNationId,
    name: '기준국',
    color: '#777777',
    capitalCityId: occupiedCityId,
    chiefGeneralId: null,
    gold: 1_000,
    rice: 1_000,
    power: 0,
    level: 2,
    typeCode: 'che_유가',
    meta: { tech: 120 },
};

const map: MapDefinition = {
    id: 'test',
    name: 'test',
    cities: [occupiedCityId, 990_084, 990_085, targetCityId].map((id, index, rows) => ({
        id,
        name: `지도도시${id}`,
        level: 5,
        region: 1,
        position: { x: index, y: 0 },
        connections: [...(index > 0 ? [rows[index - 1]!] : []), ...(index + 1 < rows.length ? [rows[index + 1]!] : [])],
        max: {
            population: 50_000,
            agriculture: 5_000,
            commerce: 6_000,
            security: 7_000,
            defence: 8_000,
            wall: 9_000,
        },
        initial: {
            population: 10_000,
            agriculture: 1_000,
            commerce: 2_000,
            security: 3_000,
            defence: 4_000,
            wall: 5_000,
        },
    })),
};

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['RaiseNPCNation'], ['ProvideNPCTroopLeader']],
    meta: {},
};

integration('RaiseNPCNation database persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const clean = async () => {
        await db.logEntry.deleteMany({
            where: {
                OR: [
                    { generalId: { in: createdGeneralIds } },
                    { year: 200, month: 1, text: { contains: '공백지에 임의의 국가' } },
                ],
            },
        });
        await db.generalTurn.deleteMany({ where: { generalId: { in: createdGeneralIds } } });
        await db.rankData.deleteMany({ where: { generalId: { in: createdGeneralIds } } });
        await db.troop.deleteMany({ where: { troopLeaderId: { in: createdGeneralIds } } });
        await db.general.deleteMany({ where: { id: { in: createdGeneralIds } } });
        await db.nationTurn.deleteMany({ where: { nationId: createdNationId } });
        await db.diplomacy.deleteMany({
            where: {
                OR: [{ srcNationId: createdNationId }, { destNationId: createdNationId }],
            },
        });
        await db.nation.deleteMany({ where: { id: { in: [createdNationId, existingNationId] } } });
        await db.city.deleteMany({ where: { id: { in: [occupiedCityId, targetCityId] } } });
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

    it('commits the nation, city, diplomacy, ruler, turns, ranks, and history in one flush', async () => {
        const referenceTrace = runReferenceNpcNationLifecycle();
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
        await createCity(occupiedCity);
        await createCity(targetCity);
        await db.nation.create({
            data: {
                id: existingNation.id,
                name: existingNation.name,
                color: existingNation.color,
                capitalCityId: existingNation.capitalCityId,
                chiefGeneralId: null,
                gold: existingNation.gold,
                rice: existingNation.rice,
                tech: 120,
                level: existingNation.level,
                typeCode: existingNation.typeCode,
                meta: existingNation.meta,
            },
        });
        const stateRow = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-raise-npc-nation-persistence',
                currentYear: 199,
                currentMonth: 12,
                tickSeconds: 600,
                config: {},
                meta: {
                    hiddenSeed: 'raise-npc-nation-persistence',
                    lastGeneralId: createdGeneralId - 1,
                    lastNationId: createdNationId - 1,
                    lastNPCTroopLeaderID: 40,
                    serverId: 'raise-npc-nation-persistence',
                },
            },
        });
        const state: TurnWorldState = {
            id: stateRow.id,
            currentYear: 199,
            currentMonth: 12,
            tickSeconds: 600,
            lastTurnTime: new Date('0199-12-01T00:00:00.000Z'),
            meta: {
                hiddenSeed: 'raise-npc-nation-persistence',
                lastGeneralId: createdGeneralId - 1,
                lastNationId: createdNationId - 1,
                lastNPCTroopLeaderID: 40,
                serverId: 'raise-npc-nation-persistence',
            },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 165, min: 15, max: 80, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 65 },
                iconPath: '.',
                map: {},
                const: {
                    retirementYear: 80,
                    availablePersonality: ['che_안전'],
                    randGenFirstName: ['가'],
                    randGenMiddleName: [''],
                    randGenLastName: ['나'],
                },
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map,
            generals: [],
            cities: [occupiedCity, targetCity],
            nations: [existingNation],
            troops: [],
            diplomacy: [],
            events: [event],
            initialEvents: [],
        };
        const reservedTurns = new InMemoryReservedTurnStore(db, { maxGeneralTurns: 30, maxNationTurns: 12 });
        let world: InMemoryTurnWorld | null = null;
        const handler = createRaiseNpcNationHandler({
            getWorld: () => world,
            reservedTurns,
            env: buildCommandEnv(snapshot.scenarioConfig),
            map,
            loadArchivedNationMaxId: async () => 0,
        });
        const provide = createProvideNpcTroopLeaderHandler({
            getWorld: () => world,
            reservedTurns,
            env: buildCommandEnv(snapshot.scenarioConfig),
        });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createMonthlyEventHandler({
                getWorld: () => world,
                startYear: 190,
                actions: new Map([
                    ['RaiseNPCNation', handler],
                    ['ProvideNPCTroopLeader', provide],
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
                name: 'ⓤNPC건국도시',
                capitalCityId: targetCityId,
                chiefGeneralId: createdGeneralId,
                gold: 0,
                rice: 2_000,
                tech: 120,
                level: 2,
            });
            expect(await db.city.findUniqueOrThrow({ where: { id: targetCityId } })).toMatchObject({
                nationId: createdNationId,
                trust: 100,
                population: occupiedCity.population,
                agriculture: occupiedCity.agriculture,
                commerce: occupiedCity.commerce,
                security: occupiedCity.security,
                defence: occupiedCity.defence,
                wall: occupiedCity.wall,
            });
            expect(await db.general.findUniqueOrThrow({ where: { id: createdGeneralId } })).toMatchObject({
                name: 'ⓤNPC건국도시태수',
                nationId: createdNationId,
                cityId: targetCityId,
                officerLevel: 12,
                npcState: 6,
            });
            expect(await db.generalTurn.count({ where: { generalId: createdGeneralId } })).toBe(30);
            expect(await db.nationTurn.count({ where: { nationId: createdNationId } })).toBe(48);
            expect(await db.rankData.count({ where: { generalId: createdGeneralId } })).toBe(44);
            expect(
                await db.diplomacy.count({
                    where: {
                        OR: [{ srcNationId: createdNationId }, { destNationId: createdNationId }],
                    },
                })
            ).toBe(2);
            expect(
                await db.general.findMany({
                    where: { id: { in: [existingNationLeaderId, createdNationLeaderId] } },
                    orderBy: { id: 'asc' },
                    select: {
                        id: true,
                        name: true,
                        nationId: true,
                        cityId: true,
                        troopId: true,
                        npcState: true,
                    },
                })
            ).toEqual([
                {
                    id: existingNationLeaderId,
                    name: '㉥부대장  41',
                    nationId: existingNationId,
                    cityId: occupiedCityId,
                    troopId: existingNationLeaderId,
                    npcState: 5,
                },
                {
                    id: createdNationLeaderId,
                    name: '㉥부대장  42',
                    nationId: createdNationId,
                    cityId: targetCityId,
                    troopId: createdNationLeaderId,
                    npcState: 5,
                },
            ]);
            expect(
                await db.troop.count({
                    where: { troopLeaderId: { in: [existingNationLeaderId, createdNationLeaderId] } },
                })
            ).toBe(2);
            for (const leaderId of [existingNationLeaderId, createdNationLeaderId]) {
                expect(
                    await db.generalTurn.count({
                        where: { generalId: leaderId, actionCode: 'che_집합' },
                    })
                ).toBe(30);
                expect(await db.rankData.count({ where: { generalId: leaderId } })).toBe(44);
            }
            expect(await db.worldState.findUniqueOrThrow({ where: { id: stateRow.id } })).toMatchObject({
                meta: expect.objectContaining({ lastNPCTroopLeaderID: 42 }),
            });
            expect(
                await db.logEntry.findFirst({
                    where: { year: 200, month: 1, text: { contains: '공백지에 임의의 국가' } },
                    select: { text: true },
                })
            ).toEqual({
                text: '<C>●</>200년 1월:<L><b>【공지】</b></>공백지에 임의의 국가가 생성되었습니다.',
            });
            if (referenceTrace) {
                expect(referenceTrace.phases).toEqual({
                    afterRaise: {
                        createdNationCount: 1,
                        createdGeneralCount: 1,
                        generalCountsPerCreatedNation: [1],
                        historyLogs: [
                            '<C>●</>200년 1월:<L><b>【공지】</b></>공백지에 임의의 국가가 생성되었습니다.',
                        ],
                    },
                    afterProvide: {
                        createdLeaderCount: 2,
                        leaderCountsPerActiveNation: [1],
                        troopCount: 2,
                        gatherTurnCounts: [30],
                        leaderCounterDelta: 2,
                    },
                });
            }
        } finally {
            await dbHooks.close();
            await db.worldState.delete({ where: { id: stateRow.id } });
        }
    });
});
