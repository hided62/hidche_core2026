import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asRecord } from '@sammo-ts/common';
import { createDatabaseTurnHooks } from '@sammo-ts/game-engine/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '@sammo-ts/game-engine/turn/inMemoryWorld.js';
import { createReservedTurnHandler } from '@sammo-ts/game-engine/turn/reservedTurnHandler.js';
import {
    InMemoryReservedTurnStore,
    ReservedTurnLeaseConflictError,
} from '@sammo-ts/game-engine/turn/reservedTurnStore.js';
import { loadMapDefinitionByName } from '@sammo-ts/game-engine/scenario/mapLoader.js';
import { loadUnitSetDefinitionByName } from '@sammo-ts/game-engine/scenario/unitSetLoader.js';
import { loadTurnWorldFromDatabase } from '@sammo-ts/game-engine/turn/worldLoader.js';
import { createGamePostgresConnector, type GamePrismaClient, type InputJsonValue } from '@sammo-ts/infra';

import {
    buildCoreTurnCommandWorldInput,
    createCoreTurnCommandProfile,
    resolveCoreTurnCommandArgs,
    runCoreTurnCommandTrace,
    type TurnCommandFixtureRequest,
} from '../src/turn-differential/coreCommandTrace.js';
import {
    clearCoreTurnCommandPersistenceFixture,
    seedCoreTurnCommandPersistenceFixture,
} from '../src/turn-differential/coreCommandPersistenceFixture.js';
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

const assertDedicatedDatabase = (rawUrl: string): void => {
    const schema = new URL(rawUrl).searchParams.get('schema');
    if (!schema?.endsWith('live_sortie_persistence')) {
        throw new Error(`Refusing to mutate non-dedicated schema: ${schema ?? '(missing)'}`);
    }
};

const readFixture = (fixtureName: string, scenarioEffect?: string): TurnCommandFixtureRequest => {
    const fixturePath = path.join(
        workspaceRoot!,
        `docker_compose_files/reference/fixtures/turn-differential/${fixtureName}`
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
                ...(scenarioEffect ? { scenarioEffect } : {}),
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

const cleanup = clearCoreTurnCommandPersistenceFixture;

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

    beforeEach(async () => {
        await cleanup(db);
    });

    afterAll(async () => {
        await cleanup(db);
        await disconnect?.();
    });

    it('rejects an unknown persisted scenario effect before turn execution', async () => {
        await db.worldState.create({
            data: {
                id: 1,
                scenarioCode: 'invalid-scenario-effect',
                currentYear: 180,
                currentMonth: 1,
                tickSeconds: 600,
                config: asJson({
                    stat: {
                        total: 300,
                        min: 10,
                        max: 100,
                        npcTotal: 150,
                        npcMax: 50,
                        npcMin: 10,
                        chiefMin: 65,
                    },
                    iconPath: '',
                    map: {},
                    const: {},
                    environment: {
                        mapName: 'che',
                        unitSet: 'che',
                        scenarioEffect: 'event_Missing',
                    },
                }),
                meta: {},
            },
        });

        await expect(loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! })).rejects.toThrow(
            'world_state.config is invalid'
        );
    });

    it.each([
        ['conquest and nation collapse', 'live-sortie-conquest.json'],
        ['collapsed nation conflict cleanup', 'live-sortie-collapse-conflict.json'],
        ['single defending general', 'live-sortie-defender.json'],
        ['multiple defending generals', 'live-sortie-multiple-defenders.json'],
        ['supply retreat', 'live-sortie-supply-retreat.json'],
        ['noncapital conquest', 'live-sortie-noncapital-conquest.json'],
        ['emergency capital', 'live-sortie-emergency-capital.json'],
        ['conflict arbitration', 'live-sortie-conflict-arbitration.json'],
        ['tied conflict', 'live-sortie-conflict-tie.json'],
        ['StrongAttacker scenario effect', 'live-sortie-multiple-defenders.json', 'event_StrongAttacker'],
    ])(
        '%s rolls back a lost lease and flushes exactly once on retry',
        async (_label, fixtureName, scenarioEffect?: string) => {
            const request = readFixture(fixtureName, scenarioEffect);
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const expected = await runCoreTurnCommandTrace(request, reference.before);
            if (scenarioEffect) {
                expect(expected.rng).toEqual(reference.rng);
                expect(
                    reference.after.logs.some((entry) => typeof entry.text === 'string' && entry.text.includes('진격'))
                ).toBe(true);
                expect(
                    expected.after.logs.some((entry) => typeof entry.text === 'string' && entry.text.includes('진격'))
                ).toBe(true);
            }
            const coreArgs = resolveCoreTurnCommandArgs(request);
            const unitSet = await loadUnitSetDefinitionByName('che');
            const map = await loadMapDefinitionByName('che');
            const { state, snapshot } = buildCoreTurnCommandWorldInput(request, reference.before, unitSet, map);

            await seedCoreTurnCommandPersistenceFixture(db, {
                worldInput: { state, snapshot, map },
                scenarioCode: 'live-sortie-persistence',
                generalTurns: snapshot.generals.flatMap((general) =>
                    Array.from({ length: 30 }, (_, turnIndex) => ({
                        generalId: general.id,
                        turnIndex,
                        action: general.id === request.actorGeneralId && turnIndex === 0 ? request.action : '휴식',
                        args: general.id === request.actorGeneralId && turnIndex === 0 ? coreArgs : {},
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
            for (const dirtyGeneral of dirtyBeforeFailure.generals) {
                expect(dirtyGeneral.recentWarTime?.toISOString() ?? null).toBe(
                    expected.after.generals.find((general) => general.id === dirtyGeneral.id)?.recentWarTime ?? null
                );
            }
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
                expect(await db.oldNation.count()).toBe(0);
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

                const persistedTurns = await db.generalTurn.findMany({
                    where: { generalId: request.actorGeneralId },
                    orderBy: { turnIdx: 'asc' },
                });
                const expectedActor = expected.after.generals.find((general) => general.id === request.actorGeneralId);
                const persistedActor = await db.general.findUniqueOrThrow({
                    where: { id: request.actorGeneralId },
                });
                expect(persistedActor.turnTime.toISOString()).toBe(expectedActor?.turnTime);
                expect(persistedActor.recentWarTime?.toISOString()).toBe(expectedActor?.recentWarTime);
                expect(asRecord(persistedActor.meta).myset).toBe(expectedActor?.mySet);
                expect(asRecord(persistedActor.meta).killturn).toBe(expectedActor?.killTurn);
                expect(asRecord(persistedActor.lastTurn).command).toBe(asRecord(expectedActor?.lastTurn).command);
                expect(persistedTurns[0]?.actionCode).toBe('휴식');
                for (const expectedGeneral of expected.after.generals) {
                    const persistedGeneral = await db.general.findUniqueOrThrow({
                        where: { id: Number(expectedGeneral.id) },
                    });
                    expect(persistedGeneral).toMatchObject({
                        nationId: expectedGeneral.nationId,
                        cityId: expectedGeneral.cityId,
                        crew: expectedGeneral.crew,
                    });
                    expect(persistedGeneral.turnTime.toISOString()).toBe(expectedGeneral.turnTime);
                    expect(persistedGeneral.recentWarTime?.toISOString() ?? null).toBe(expectedGeneral.recentWarTime);
                }
                for (const expectedCity of expected.after.cities) {
                    const persistedCity = await db.city.findUniqueOrThrow({
                        where: { id: Number(expectedCity.id) },
                    });
                    expect(persistedCity).toMatchObject({
                        nationId: expectedCity.nationId,
                        defence: expectedCity.defence,
                        conflict: expectedCity.conflict,
                    });
                }
                for (const beforeNation of expected.before.nations) {
                    const expectedNation = expected.after.nations.find((nation) => nation.id === beforeNation.id);
                    const persistedNation = await db.nation.findUnique({
                        where: { id: Number(beforeNation.id) },
                    });
                    if (!expectedNation) {
                        expect(persistedNation).toBeNull();
                    } else {
                        expect(persistedNation).toMatchObject({
                            capitalCityId: expectedNation.capitalCityId,
                            gold: expectedNation.gold,
                            rice: expectedNation.rice,
                        });
                    }
                }
                const deletedNationCount = expected.before.nations.filter(
                    (nation) => !expected.after.nations.some((afterNation) => afterNation.id === nation.id)
                ).length;
                expect(await db.oldNation.count()).toBe(deletedNationCount);
                expect(await db.logEntry.count()).toBe(expected.after.logs.length);
                expect(world.peekDirtyState().logs).toEqual([]);
                expect(reservedTurns.peekDirtyState().generalIds).toEqual([]);

                const committedRevision = await db.generalTurnRevision.findUniqueOrThrow({
                    where: { generalId: request.actorGeneralId },
                });
                const logCount = await db.logEntry.count();
                const oldNationCount = await db.oldNation.count();
                await hooks.hooks.flushChanges?.(turnRunResult);
                expect(await db.logEntry.count()).toBe(logCount);
                expect(await db.oldNation.count()).toBe(oldNationCount);
                expect(
                    await db.generalTurnRevision.findUniqueOrThrow({
                        where: { generalId: request.actorGeneralId },
                    })
                ).toMatchObject({
                    revision: committedRevision.revision,
                    leaseOwner: committedRevision.leaseOwner,
                });
                const reloaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
                expect(reloaded.snapshot.scenarioConfig.environment.scenarioEffect).toBe(scenarioEffect ?? null);
            } finally {
                await hooks.close();
            }
        },
        120_000
    );
});
