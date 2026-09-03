import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formatLogText, LogFormat, type City, type TurnSchedule } from '@sammo-ts/logic';
import { InMemoryTurnWorld } from '@sammo-ts/game-engine/turn/inMemoryWorld.js';
import { createDatabaseTurnHooks } from '@sammo-ts/game-engine/turn/databaseHooks.js';
import { createTurnDaemonCommandHandler } from '@sammo-ts/game-engine/turn/worldCommandHandler.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '@sammo-ts/game-engine/turn/types.js';
import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';

import {
    findTurnDifferentialWorkspaceRoot,
    runReferenceTurnCommandTraceRequest,
} from '../src/turn-differential/referenceSnapshot.js';

const workspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const integration =
    workspaceRoot && process.env.TURN_DIFFERENTIAL_REFERENCE === '1'
        ? describe
        : (_name: string, _factory: () => void): void => undefined;
const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const persistence = describe.skipIf(!databaseUrl);
const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };

const buildGeneral = (id: number, cityId: number, troopId: number, userId: string | null = null): TurnGeneral => ({
    id,
    userId,
    name: `fixture-general-${id}`,
    nationId: 1,
    cityId,
    troopId,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    turnTime: new Date('0180-01-01T00:00:00Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    penalty: {},
    officerLevel: 1,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 100,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
});

const buildCity = (id: number, name: string): City => ({
    id,
    name,
    nationId: 1,
    level: 1,
    state: 0,
    population: 1_000,
    populationMax: 2_000,
    agriculture: 500,
    agricultureMax: 1_000,
    commerce: 500,
    commerceMax: 1_000,
    security: 500,
    securityMax: 1_000,
    supplyState: 1,
    frontState: 0,
    defence: 500,
    defenceMax: 1_000,
    wall: 500,
    wallMax: 1_000,
    meta: {},
});

integration('scenario 911 troop join static event parity', () => {
    it('moves the joining member to the leader city with the same plain log', async () => {
        const reference = runReferenceTurnCommandTraceRequest(workspaceRoot!, {
            kind: 'troopJoinStaticEvent',
            actorGeneralId: 1,
            action: 'sammo\\API\\Troop\\JoinTroop',
            args: { troopID: 2 },
            setup: {
                isolateWorld: true,
                world: { year: 180, month: 1 },
                nations: [{ id: 1, name: '테스트국', capitalCityId: 3, level: 1 }],
                cities: [
                    { id: 3, nationId: 1 },
                    { id: 70, nationId: 1 },
                ],
                generals: [
                    { id: 1, name: '가입장수', nationId: 1, cityId: 3, troopId: 0 },
                    { id: 2, name: '부대장', nationId: 1, cityId: 70, troopId: 2 },
                ],
                troops: [{ id: 2, nationId: 1, name: '백마대' }],
            },
            observe: {
                generalIds: [1, 2],
                cityIds: [3, 70],
                nationIds: [1],
            },
        });
        const referenceActor = reference.after.generals.find((entry) => entry.id === 1);
        const destination = reference.after.cities.find((entry) => entry.id === 70);
        expect(reference.execution.outcome).toEqual({ completed: true });
        expect(reference.rng).toEqual([]);
        expect(referenceActor).toMatchObject({ troopId: 2, cityId: 70 });
        expect(destination?.name).toEqual(expect.any(String));

        const state: TurnWorldState = {
            id: 1,
            currentYear: 180,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0180-01-01T00:00:00Z'),
            meta: { killturn: 24 },
        };
        const actorUserId = 'troop-static-event-parity-user';
        const actor = buildGeneral(1, 3, 0, actorUserId);
        const snapshot: TurnWorldSnapshot = {
            generals: [actor, buildGeneral(2, 70, 2)],
            cities: [buildCity(3, '출발지'), buildCity(70, String(destination?.name))],
            nations: [
                {
                    id: 1,
                    name: '테스트국',
                    color: '#ff0000',
                    capitalCityId: 3,
                    chiefGeneralId: 2,
                    gold: 1_000,
                    rice: 1_000,
                    power: 0,
                    level: 1,
                    typeCode: 'che_중립',
                    meta: {},
                },
            ],
            troops: [{ id: 2, nationId: 1, name: '백마대' }],
            diplomacy: [],
            events: [],
            initialEvents: [],
            scenarioConfig: {
                stat: {
                    total: 300,
                    min: 10,
                    max: 100,
                    npcTotal: 150,
                    npcMax: 50,
                    npcMin: 10,
                    chiefMin: 70,
                },
                iconPath: '',
                map: {},
                const: {
                    staticEventHandlers: {
                        'sammo\\API\\Troop\\JoinTroop': ['event_부대탑승즉시이동'],
                    },
                },
                environment: { mapName: 'miniche', unitSet: 'che_except_siege' },
            },
            map: {
                id: 'miniche',
                name: 'miniche',
                cities: [],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            },
        };
        const world = new InMemoryTurnWorld(state, snapshot, { schedule });
        const handler = createTurnDaemonCommandHandler({ world });

        await expect(
            handler.handle({ type: 'troopJoin', userId: actorUserId, generalId: 1, troopId: 2 })
        ).resolves.toMatchObject({
            ok: true,
        });
        expect(world.getGeneralById(1)).toMatchObject({
            troopId: referenceActor?.troopId,
            cityId: referenceActor?.cityId,
        });

        const referenceLog = reference.after.logs.find(
            (entry) =>
                typeof entry.id === 'number' && entry.id > reference.before.watermarks.logId && entry.generalId === 1
        );
        const coreLog = world.peekDirtyState().logs.at(-1);
        expect(coreLog).toBeDefined();
        expect(referenceLog).toMatchObject({
            scope: 'general',
            category: 'action',
            generalId: 1,
            text: formatLogText(coreLog!.text, coreLog!.format ?? LogFormat.RAWTEXT, 180, 1),
        });
    }, 120_000);
});

persistence('scenario 911 troop join static event persistence', () => {
    const nationId = 994_911;
    const actorId = 994_911;
    const leaderId = 994_912;
    const sourceCityId = 994_911;
    const destinationCityId = 994_912;
    const scenarioCode = 'scenario911-troop-join-static-event';
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const cleanup = async (): Promise<void> => {
        await db.logEntry.deleteMany({ where: { generalId: { in: [actorId, leaderId] } } });
        await db.troop.deleteMany({ where: { troopLeaderId: leaderId } });
        await db.general.deleteMany({ where: { id: { in: [actorId, leaderId] } } });
        await db.city.deleteMany({ where: { id: { in: [sourceCityId, destinationCityId] } } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await db.worldState.deleteMany({ where: { scenarioCode } });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await cleanup();
    });

    afterAll(async () => {
        await cleanup();
        await closeDb?.();
    });

    it('flushes membership, immediate city movement, and the plain log together', async () => {
        const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {
                staticEventHandlers: {
                    'sammo\\API\\Troop\\JoinTroop': ['event_부대탑승즉시이동'],
                },
            },
            environment: { mapName: 'miniche', unitSet: 'che_except_siege' },
        };
        const actorUserId = 'troop-static-event-persistence-user';
        const actor = buildGeneral(actorId, sourceCityId, 0, actorUserId);
        const leader = buildGeneral(leaderId, destinationCityId, leaderId);
        actor.name = '가입장수';
        actor.nationId = nationId;
        leader.name = '부대장';
        leader.nationId = nationId;
        const sourceCity = buildCity(sourceCityId, '장안');
        const destinationCity = buildCity(destinationCityId, '낙양');
        sourceCity.nationId = nationId;
        destinationCity.nationId = nationId;

        await db.nation.create({
            data: {
                id: nationId,
                name: '테스트국',
                color: '#ff0000',
                capitalCityId: sourceCityId,
                chiefGeneralId: null,
                gold: 1_000,
                rice: 1_000,
                tech: 0,
                level: 1,
                typeCode: 'che_중립',
                meta: {},
            },
        });
        await db.city.createMany({
            data: [sourceCity, destinationCity].map((city) => ({
                id: city.id,
                name: city.name,
                level: city.level,
                nationId: city.nationId,
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
                defence: city.defence,
                defenceMax: city.defenceMax,
                wall: city.wall,
                wallMax: city.wallMax,
                region: 1,
            })),
        });
        await db.general.createMany({
            data: [actor, leader].map((general) => ({
                id: general.id,
                userId: general.userId,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                troopId: general.troopId,
                leadership: general.stats.leadership,
                strength: general.stats.strength,
                intel: general.stats.intelligence,
                officerLevel: general.officerLevel,
                npcState: general.npcState,
                gold: general.gold,
                rice: general.rice,
                crew: general.crew,
                crewTypeId: general.crewTypeId,
                train: general.train,
                atmos: general.atmos,
                age: general.age,
                turnTime: general.turnTime,
                meta: general.meta,
            })),
        });
        await db.troop.create({
            data: {
                troopLeaderId: leaderId,
                nationId,
                name: '백마대',
            },
        });
        const worldRow = await db.worldState.create({
            data: {
                scenarioCode,
                currentYear: 180,
                currentMonth: 1,
                tickSeconds: 600,
                config: scenarioConfig as unknown as GamePrisma.InputJsonValue,
                meta: {},
            },
        });
        const state: TurnWorldState = {
            id: worldRow.id,
            currentYear: 180,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0180-01-01T00:00:00Z'),
            meta: {},
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig,
            map: {
                id: 'miniche',
                name: 'miniche',
                cities: [],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            },
            generals: [actor, leader],
            cities: [sourceCity, destinationCity],
            nations: [
                {
                    id: nationId,
                    name: '테스트국',
                    color: '#ff0000',
                    capitalCityId: sourceCityId,
                    chiefGeneralId: null,
                    gold: 1_000,
                    rice: 1_000,
                    power: 0,
                    level: 1,
                    typeCode: 'che_중립',
                    meta: {},
                },
            ],
            troops: [{ id: leaderId, nationId, name: '백마대' }],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };
        const world = new InMemoryTurnWorld(state, snapshot, { schedule });
        const handler = createTurnDaemonCommandHandler({ world });
        const dbHooks = await createDatabaseTurnHooks(databaseUrl!, world);

        try {
            await expect(
                handler.handle({ type: 'troopJoin', userId: actorUserId, generalId: actorId, troopId: leaderId })
            ).resolves.toMatchObject({
                ok: true,
            });
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.general.findUniqueOrThrow({ where: { id: actorId } })).toMatchObject({
                userId: actorUserId,
                troopId: leaderId,
                cityId: destinationCityId,
            });
            expect(
                await db.logEntry.findFirstOrThrow({
                    where: { generalId: actorId },
                    select: { scope: true, category: true, text: true, year: true, month: true },
                })
            ).toEqual({
                scope: 'GENERAL',
                category: 'ACTION',
                text: '<C>●</>부대 주둔지인 <G><b>낙양</b></>으로 즉시 이동합니다.',
                year: 180,
                month: 1,
            });
        } finally {
            await dbHooks.close();
        }
    });
});
