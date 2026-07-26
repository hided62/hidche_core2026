import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRecord } from '@sammo-ts/common';
import { buildLegacyComparableRankRows } from '@sammo-ts/game-engine/turn/rankData.js';
import { createDatabaseTurnHooks } from '@sammo-ts/game-engine/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '@sammo-ts/game-engine/turn/inMemoryWorld.js';
import { createReservedTurnHandler } from '@sammo-ts/game-engine/turn/reservedTurnHandler.js';
import {
    InMemoryReservedTurnStore,
    ReservedTurnLeaseConflictError,
} from '@sammo-ts/game-engine/turn/reservedTurnStore.js';
import { loadMapDefinitionByName } from '@sammo-ts/game-engine/scenario/mapLoader.js';
import { loadUnitSetDefinitionByName } from '@sammo-ts/game-engine/scenario/unitSetLoader.js';
import { createGamePostgresConnector, type GamePrismaClient, type InputJsonValue } from '@sammo-ts/infra';

import {
    buildCoreTurnCommandWorldInput,
    createCoreTurnCommandProfile,
    resolveCoreTurnCommandArgs,
    runCoreTurnCommandTrace,
    type TurnCommandFixtureRequest,
} from '../src/turn-differential/coreCommandTrace.js';
import {
    findTurnDifferentialWorkspaceRoot,
    runReferenceTurnCommandTraceRequest,
} from '../src/turn-differential/referenceSnapshot.js';

const databaseUrl = process.env.LIVE_SORTIE_PERSISTENCE_DATABASE_URL;
const workspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const integration = describe.skipIf(!databaseUrl || !workspaceRoot || process.env.TURN_DIFFERENTIAL_REFERENCE !== '1');
const leaseOwner = 'live-sortie-persistence-daemon';
const turnRunResult = {
    lastTurnTime: '0183-01-01T00:00:00.000Z',
    processedGenerals: 1,
    processedTurns: 1,
    durationMs: 0,
    partial: false,
} as const;

const asJson = (value: unknown): InputJsonValue => value as InputJsonValue;
const nullableCode = (value: string | null | undefined): string => value ?? 'None';

const assertDedicatedDatabase = (rawUrl: string): void => {
    const schema = new URL(rawUrl).searchParams.get('schema');
    if (!schema?.endsWith('live_sortie_persistence')) {
        throw new Error(`Refusing to mutate non-dedicated schema: ${schema ?? '(missing)'}`);
    }
};

const readFixture = (): TurnCommandFixtureRequest => {
    const fixturePath = path.join(
        workspaceRoot!,
        'docker_compose_files/reference/fixtures/turn-differential/live-sortie-defender.json'
    );
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as TurnCommandFixtureRequest;
    return {
        ...fixture,
        includeLifecycle: true,
        setup: {
            ...fixture.setup,
            isolateWorld: true,
            world: {
                ...fixture.setup?.world,
                hiddenSeed: 'turn-command-differential-seed',
            },
            generals: fixture.setup?.generals?.map((general) => ({
                ...general,
                personality: 'None',
                specialDomestic: 'None',
                specialWar: 'None',
                itemHorse: 'None',
                itemWeapon: 'None',
                itemBook: 'None',
                itemExtra: 'None',
            })),
        },
    };
};

const cleanup = async (db: GamePrismaClient): Promise<void> => {
    await db.logEntry.deleteMany();
    await db.rankData.deleteMany();
    await db.generalTurn.deleteMany();
    await db.generalTurnRevision.deleteMany();
    await db.nationTurn.deleteMany();
    await db.nationTurnRevision.deleteMany();
    await db.diplomacy.deleteMany();
    await db.general.deleteMany();
    await db.troop.deleteMany();
    await db.city.deleteMany();
    await db.nation.deleteMany();
    await db.worldState.deleteMany();
};

integration('live sortie PostgreSQL persistence retry', () => {
    let db: GamePrismaClient;
    let disconnect: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        assertDedicatedDatabase(databaseUrl!);
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnect = () => connector.disconnect();
        await cleanup(db);
    });

    afterAll(async () => {
        await cleanup(db);
        await disconnect?.();
    });

    it('rolls back a lost queue lease, retains dirty state, and flushes the same sortie exactly once on retry', async () => {
        const request = readFixture();
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const expected = await runCoreTurnCommandTrace(request, reference.before);
        const coreArgs = resolveCoreTurnCommandArgs(request);
        const unitSet = await loadUnitSetDefinitionByName('che');
        const map = await loadMapDefinitionByName('che');
        const { state, snapshot } = buildCoreTurnCommandWorldInput(request, reference.before, unitSet, map);

        await db.worldState.create({
            data: {
                id: state.id,
                scenarioCode: 'live-sortie-persistence',
                currentYear: state.currentYear,
                currentMonth: state.currentMonth,
                tickSeconds: state.tickSeconds,
                config: asJson(snapshot.scenarioConfig),
                meta: asJson(state.meta),
            },
        });
        await db.nation.createMany({
            data: snapshot.nations.map((nation) => ({
                id: nation.id,
                name: nation.name,
                color: nation.color,
                capitalCityId: nation.capitalCityId,
                chiefGeneralId: nation.chiefGeneralId,
                gold: nation.gold,
                rice: nation.rice,
                tech: Number(nation.meta.tech ?? 0),
                level: nation.level,
                typeCode: nation.typeCode,
                meta: asJson(nation.meta),
            })),
        });
        await db.city.createMany({
            data: snapshot.cities.map((city) => {
                const definition = map.cities.find((entry) => entry.id === city.id);
                return {
                    id: city.id,
                    name: city.name,
                    level: city.level,
                    nationId: city.nationId,
                    supplyState: city.supplyState,
                    frontState: city.frontState,
                    population: Math.round(city.population),
                    populationMax: city.populationMax,
                    agriculture: Math.round(city.agriculture),
                    agricultureMax: city.agricultureMax,
                    commerce: Math.round(city.commerce),
                    commerceMax: city.commerceMax,
                    security: Math.round(city.security),
                    securityMax: city.securityMax,
                    trust: Number(city.meta.trust ?? 0),
                    trade: Number(city.meta.trade ?? 100),
                    defence: Math.round(city.defence),
                    defenceMax: city.defenceMax,
                    wall: Math.round(city.wall),
                    wallMax: city.wallMax,
                    region: definition?.region ?? 0,
                    conflict: asJson(city.conflict ?? {}),
                    meta: asJson({ ...city.meta, state: city.state }),
                };
            }),
        });
        await db.troop.createMany({
            data: snapshot.troops.map((troop) => ({
                troopLeaderId: troop.id,
                nationId: troop.nationId,
                name: troop.name,
            })),
        });
        await db.general.createMany({
            data: snapshot.generals.map((general) => ({
                id: general.id,
                userId: general.userId,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                troopId: general.troopId,
                npcState: general.npcState,
                affinity: general.affinity,
                bornYear: general.bornYear,
                deadYear: general.deadYear,
                picture: general.picture,
                leadership: Math.round(general.stats.leadership),
                strength: Math.round(general.stats.strength),
                intel: Math.round(general.stats.intelligence),
                injury: Math.round(general.injury),
                experience: Math.round(general.experience),
                dedication: Math.round(general.dedication),
                officerLevel: general.officerLevel,
                gold: Math.round(general.gold),
                rice: Math.round(general.rice),
                crew: Math.round(general.crew),
                crewTypeId: general.crewTypeId,
                train: Math.round(general.train),
                atmos: Math.round(general.atmos),
                age: general.age,
                startAge: general.startAge,
                personalCode: nullableCode(general.role.personality),
                specialCode: nullableCode(general.role.specialDomestic),
                special2Code: nullableCode(general.role.specialWar),
                horseCode: nullableCode(general.role.items.horse),
                weaponCode: nullableCode(general.role.items.weapon),
                bookCode: nullableCode(general.role.items.book),
                itemCode: nullableCode(general.role.items.item),
                turnTime: general.turnTime,
                recentWarTime: general.recentWarTime,
                lastTurn: asJson(general.lastTurn ?? { command: '휴식' }),
                meta: asJson(general.meta),
                penalty: asJson(general.penalty ?? {}),
            })),
        });
        await db.rankData.createMany({
            data: snapshot.generals.flatMap((general) =>
                buildLegacyComparableRankRows(general).map((row) => ({
                    generalId: row.generalId,
                    nationId: row.nationId,
                    type: row.type,
                    value: row.value,
                }))
            ),
        });
        await db.diplomacy.createMany({
            data: snapshot.diplomacy.map((entry) => ({
                srcNationId: entry.fromNationId,
                destNationId: entry.toNationId,
                stateCode: entry.state,
                term: entry.term,
                isDead: entry.dead !== 0,
                meta: asJson(entry.meta),
            })),
        });
        await db.generalTurn.createMany({
            data: snapshot.generals.flatMap((general) =>
                Array.from({ length: 30 }, (_, turnIdx) => ({
                    generalId: general.id,
                    turnIdx,
                    actionCode: general.id === request.actorGeneralId && turnIdx === 0 ? request.action : '휴식',
                    arg: asJson(general.id === request.actorGeneralId && turnIdx === 0 ? coreArgs : {}),
                }))
            ),
        });

        const reservedTurns = new InMemoryReservedTurnStore(db, {
            maxGeneralTurns: 30,
            maxNationTurns: 12,
            leaseOwner,
            leaseDurationMs: 60_000,
        });
        await reservedTurns.loadAll();
        await reservedTurns.prepareTurnsForExecution(request.actorGeneralId);

        let world: InMemoryTurnWorld | null = null;
        const handler = await createReservedTurnHandler({
            reservedTurns,
            scenarioConfig: snapshot.scenarioConfig,
            scenarioMeta: snapshot.scenarioMeta,
            map,
            unitSet,
            getWorld: () => world,
            commandProfile: createCoreTurnCommandProfile(request),
        });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            generalTurnHandler: handler,
        });
        const actor = world.getGeneralById(request.actorGeneralId);
        if (!actor) {
            throw new Error('fixture actor is missing');
        }
        world.executeGeneralTurn(actor);

        const dirtyBeforeFailure = world.peekDirtyState();
        expect(dirtyBeforeFailure.generals.length).toBeGreaterThan(0);
        expect(dirtyBeforeFailure.logs.length).toBeGreaterThan(0);
        expect(
            dirtyBeforeFailure.generals.find((general) => general.id === request.actorGeneralId)?.recentWarTime
        ).toEqual(new Date('2026-07-26T13:38:45.000Z'));
        expect(dirtyBeforeFailure.generals.find((general) => general.id === 2)?.recentWarTime).toEqual(
            new Date('2026-07-26T13:38:45.000Z')
        );
        expect(reservedTurns.peekDirtyState().generalIds).toContain(request.actorGeneralId);

        const hooks = await createDatabaseTurnHooks(databaseUrl!, world, { reservedTurns });
        try {
            await db.generalTurnRevision.update({
                where: { generalId: request.actorGeneralId },
                data: {
                    leaseOwner: 'lost-to-another-writer',
                    leaseExpiresAt: new Date(Date.now() + 60_000),
                },
            });

            await expect(hooks.hooks.flushChanges?.(turnRunResult)).rejects.toBeInstanceOf(
                ReservedTurnLeaseConflictError
            );

            const rolledBackActor = await db.general.findUniqueOrThrow({
                where: { id: request.actorGeneralId },
            });
            const rolledBackTurns = await db.generalTurn.findMany({
                where: { generalId: request.actorGeneralId },
                orderBy: { turnIdx: 'asc' },
            });
            expect(rolledBackActor.turnTime.toISOString()).toBe(
                expected.before.generals.find((general) => general.id === request.actorGeneralId)?.turnTime
            );
            expect(rolledBackActor.recentWarTime).toBeNull();
            expect(rolledBackTurns[0]?.actionCode).toBe('che_출병');
            expect(await db.logEntry.count()).toBe(0);
            expect(world.peekDirtyState().logs).toHaveLength(dirtyBeforeFailure.logs.length);
            expect(reservedTurns.peekDirtyState().generalIds).toContain(request.actorGeneralId);

            await db.generalTurnRevision.update({
                where: { generalId: request.actorGeneralId },
                data: {
                    leaseOwner,
                    leaseExpiresAt: new Date(Date.now() + 60_000),
                },
            });
            await hooks.hooks.flushChanges?.(turnRunResult);

            const persistedActor = await db.general.findUniqueOrThrow({
                where: { id: request.actorGeneralId },
            });
            const persistedDefender = await db.general.findUniqueOrThrow({ where: { id: 2 } });
            const persistedTurns = await db.generalTurn.findMany({
                where: { generalId: request.actorGeneralId },
                orderBy: { turnIdx: 'asc' },
            });
            const expectedActor = expected.after.generals.find((general) => general.id === request.actorGeneralId);
            const expectedDefender = expected.after.generals.find((general) => general.id === 2);
            expect(persistedActor.turnTime.toISOString()).toBe(expectedActor?.turnTime);
            expect(persistedActor.recentWarTime?.toISOString()).toBe(expectedActor?.recentWarTime);
            expect(persistedDefender.recentWarTime?.toISOString()).toBe(expectedDefender?.recentWarTime);
            expect(asRecord(persistedActor.meta).myset).toBe(expectedActor?.mySet);
            expect(asRecord(persistedActor.meta).killturn).toBe(expectedActor?.killTurn);
            expect(asRecord(persistedActor.lastTurn).command).toBe(asRecord(expectedActor?.lastTurn).command);
            expect(persistedTurns[0]?.actionCode).toBe('휴식');
            expect(await db.logEntry.count()).toBe(expected.after.logs.length);
            expect(world.peekDirtyState().logs).toEqual([]);
            expect(reservedTurns.peekDirtyState().generalIds).toEqual([]);

            const committedRevision = await db.generalTurnRevision.findUniqueOrThrow({
                where: { generalId: request.actorGeneralId },
            });
            const logCount = await db.logEntry.count();
            await hooks.hooks.flushChanges?.(turnRunResult);
            expect(await db.logEntry.count()).toBe(logCount);
            expect(
                await db.generalTurnRevision.findUniqueOrThrow({
                    where: { generalId: request.actorGeneralId },
                })
            ).toMatchObject({
                revision: committedRevision.revision,
                leaseOwner: committedRevision.leaseOwner,
            });
        } finally {
            await hooks.close();
        }
    }, 120_000);
});
