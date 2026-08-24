import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asRecord } from '@sammo-ts/common';
import { createDatabaseTurnHooks } from '@sammo-ts/game-engine/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '@sammo-ts/game-engine/turn/inMemoryWorld.js';
import { createReservedTurnHandler } from '@sammo-ts/game-engine/turn/reservedTurnHandler.js';
import { InMemoryReservedTurnStore } from '@sammo-ts/game-engine/turn/reservedTurnStore.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '@sammo-ts/game-engine/turn/types.js';
import { loadMapDefinitionByName } from '@sammo-ts/game-engine/scenario/mapLoader.js';
import { loadUnitSetDefinitionByName } from '@sammo-ts/game-engine/scenario/unitSetLoader.js';
import { loadTurnWorldFromDatabase } from '@sammo-ts/game-engine/turn/worldLoader.js';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import {
    clearCoreTurnCommandPersistenceFixture,
    seedCoreTurnCommandPersistenceFixture,
} from '../src/turn-differential/coreCommandPersistenceFixture.js';
import {
    buildCoreTurnCommandWorldInput,
    createCoreTurnCommandProfile,
    runCoreTurnCommandTrace,
} from '../src/turn-differential/coreCommandTrace.js';
import { readCoreDatabaseSnapshot } from '../src/turn-differential/databaseSnapshot.js';
import {
    addedFullLifecycleReferenceLogs,
    fullLifecycleSnapshotSelector,
    fullLifecycleTurnCommandRequest as request,
    projectFullLifecycleSnapshotGraph,
} from '../src/turn-differential/fullLifecycleFixture.js';
import { runReferenceFullLifecycleTrace } from '../src/turn-differential/fullLifecycleTrace.js';
import { normalizeStoredTurnLogText, orderedSemanticLogStreams } from '../src/turn-differential/logProjection.js';
import { findTurnDifferentialWorkspaceRoot } from '../src/turn-differential/referenceSnapshot.js';

const databaseUrl = process.env.TURN_FULL_LIFECYCLE_PERSISTENCE_DATABASE_URL;
const workspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const referenceSourceRoot = workspaceRoot
    ? path.resolve(process.env.REF_COMPARE_SOURCE_ROOT ?? path.join(workspaceRoot, 'ref/sam'))
    : null;
const hasFullLifecycleRunner =
    referenceSourceRoot !== null &&
    fs.existsSync(path.join(referenceSourceRoot, 'hwe/compare/turn_full_lifecycle_trace.php'));
const databaseIntegration = describe.skipIf(!databaseUrl);
const leaseOwner = 'turn-full-lifecycle-persistence-daemon';
const dedicatedSuffix = 'turn_full_lifecycle_persistence';

export const assertDedicatedTurnFullLifecycleDatabase = (rawUrl: string): void => {
    const url = new URL(rawUrl);
    const schema = url.searchParams.get('schema');
    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!schema?.endsWith(dedicatedSuffix) && !databaseName.endsWith(dedicatedSuffix)) {
        throw new Error(
            `Refusing to mutate non-dedicated turn full-lifecycle database: schema=${schema ?? '(missing)'}, database=${databaseName || '(missing)'}`
        );
    }
};

describe('turn full-lifecycle persistence database guard', () => {
    it('rejects a shared database and schema before connecting', () => {
        expect(() =>
            assertDedicatedTurnFullLifecycleDatabase('postgresql://fixture:fixture@127.0.0.1:5432/sammo?schema=public')
        ).toThrow('Refusing to mutate non-dedicated turn full-lifecycle database');
    });

    it('accepts only an explicitly dedicated schema or database name', () => {
        expect(() =>
            assertDedicatedTurnFullLifecycleDatabase(
                'postgresql://fixture:fixture@127.0.0.1:5432/sammo?schema=ci_turn_full_lifecycle_persistence'
            )
        ).not.toThrow();
        expect(() =>
            assertDedicatedTurnFullLifecycleDatabase(
                'postgresql://fixture:fixture@127.0.0.1:5432/ci_turn_full_lifecycle_persistence'
            )
        ).not.toThrow();
    });
});

databaseIntegration('Core PostgreSQL full reserved-turn lifecycle persistence', () => {
    let db: GamePrismaClient | undefined;
    let disconnect: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        assertDedicatedTurnFullLifecycleDatabase(databaseUrl!);
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnect = () => connector.disconnect();
        await clearCoreTurnCommandPersistenceFixture(db);
    });

    beforeEach(async () => {
        if (db) {
            await clearCoreTurnCommandPersistenceFixture(db);
        }
    });

    afterAll(async () => {
        try {
            if (db) {
                await clearCoreTurnCommandPersistenceFixture(db);
            }
        } finally {
            await disconnect?.();
        }
    });

    it.skipIf(!workspaceRoot || !hasFullLifecycleRunner || process.env.TURN_DIFFERENTIAL_REFERENCE !== '1')(
        'commits nation then general, both queue shifts, ordered logs, and reloadable state in one flush',
        async () => {
            if (!db) {
                throw new Error('fixture database is not connected');
            }
            const reference = runReferenceFullLifecycleTrace(workspaceRoot!, {
                ...request,
                generalAction: request.action,
                generalArgs: request.args,
                nationAction: 'che_국호변경',
                nationArgs: { nationName: '수명주기국' },
            } as unknown as Record<string, unknown>);
            const expected = await runCoreTurnCommandTrace(request, reference.before);
            const unitSet = await loadUnitSetDefinitionByName('che');
            const map = await loadMapDefinitionByName('che');
            const worldInput = buildCoreTurnCommandWorldInput(request, reference.before, unitSet, map);

            await seedCoreTurnCommandPersistenceFixture(db, {
                worldInput,
                scenarioCode: 'turn-full-lifecycle-persistence',
                generalTurns: reference.before.generalTurns,
                nationTurns: reference.before.nationTurns,
            });
            const before = await readCoreDatabaseSnapshot(databaseUrl!, fullLifecycleSnapshotSelector);
            expect(projectFullLifecycleSnapshotGraph(before)).toEqual(
                projectFullLifecycleSnapshotGraph(reference.before)
            );
            expect(projectFullLifecycleSnapshotGraph(before)).toEqual(
                projectFullLifecycleSnapshotGraph(expected.before)
            );

            const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
            expect(loaded.snapshot.scenarioConfig).toEqual(worldInput.snapshot.scenarioConfig);
            expect(loaded.snapshot.scenarioMeta).toEqual(worldInput.snapshot.scenarioMeta);
            const reservedTurns = new InMemoryReservedTurnStore(db, {
                maxGeneralTurns: 30,
                maxNationTurns: 12,
                leaseOwner,
                leaseDurationMs: 60_000,
            });
            await reservedTurns.loadAll();
            const loadedActor = loaded.snapshot.generals.find((general) => general.id === request.actorGeneralId);
            if (!loadedActor) {
                throw new Error('fixture actor is missing after database load');
            }
            await reservedTurns.prepareTurnsForExecution(loadedActor.id, {
                nationId: loadedActor.nationId,
                officerLevel: loadedActor.officerLevel,
            });

            const lifecycleActions: Array<{ kind: string; requestedAction: string; usedFallback: boolean }> = [];
            let world: InMemoryTurnWorld | null = null;
            const handler = await createReservedTurnHandler({
                reservedTurns,
                scenarioConfig: loaded.snapshot.scenarioConfig,
                scenarioMeta: loaded.snapshot.scenarioMeta,
                map: loaded.snapshot.map,
                unitSet: loaded.snapshot.unitSet,
                getWorld: () => world,
                now: () => new Date(loaded.state.lastTurnTime),
                commandProfile: createCoreTurnCommandProfile(request),
                onActionResolved: (entry) => {
                    lifecycleActions.push({
                        kind: entry.kind,
                        requestedAction: entry.requestedAction,
                        usedFallback: entry.usedFallback,
                    });
                },
            });
            world = new InMemoryTurnWorld(loaded.state, loaded.snapshot, {
                schedule: {
                    entries: [
                        {
                            startMinute: 0,
                            tickMinutes: Math.max(1, Math.round(loaded.state.tickSeconds / 60)),
                        },
                    ],
                },
                generalTurnHandler: handler,
            });
            const actor = world.getGeneralById(request.actorGeneralId);
            if (!actor) {
                throw new Error('fixture actor is missing from executable world');
            }
            world.executeGeneralTurn(actor);

            expect(lifecycleActions).toEqual([
                { kind: 'nation', requestedAction: 'che_국호변경', usedFallback: false },
                { kind: 'general', requestedAction: 'che_훈련', usedFallback: false },
            ]);
            expect(reservedTurns.getGeneralTurn(actor.id, 0).action).toBe('휴식');
            expect(reservedTurns.getNationTurn(actor.nationId, actor.officerLevel, 0).action).toBe('휴식');
            const dirtyBeforeFlush = world.peekDirtyState();
            expect(dirtyBeforeFlush.generals.map((entry) => entry.id)).toContain(actor.id);
            expect(dirtyBeforeFlush.nations.map((entry) => entry.id)).toContain(actor.nationId);
            expect(dirtyBeforeFlush.logs.length).toBeGreaterThan(0);

            const databaseBeforeFlush = await readCoreDatabaseSnapshot(databaseUrl!, fullLifecycleSnapshotSelector);
            expect(projectFullLifecycleSnapshotGraph(databaseBeforeFlush)).toEqual(
                projectFullLifecycleSnapshotGraph(before)
            );

            const hooks = await createDatabaseTurnHooks(databaseUrl!, world, { reservedTurns });
            try {
                if (!hooks.hooks.flushChanges) {
                    throw new Error('database turn hooks do not expose flushChanges');
                }
                await hooks.hooks.flushChanges({
                    lastTurnTime: loaded.state.lastTurnTime.toISOString(),
                    processedGenerals: 1,
                    processedTurns: 1,
                    durationMs: 0,
                    partial: false,
                });
            } finally {
                await hooks.close();
            }

            expect(world.peekDirtyState().logs).toEqual([]);
            expect(reservedTurns.peekDirtyState()).toMatchObject({
                generalIds: [],
                nationKeys: [],
            });

            const after = await readCoreDatabaseSnapshot(databaseUrl!, fullLifecycleSnapshotSelector);
            expect(projectFullLifecycleSnapshotGraph(after)).toEqual(
                projectFullLifecycleSnapshotGraph(reference.after)
            );
            expect(projectFullLifecycleSnapshotGraph(after)).toEqual(projectFullLifecycleSnapshotGraph(expected.after));
            expect(orderedSemanticLogStreams(after.logs)).toEqual(
                orderedSemanticLogStreams(addedFullLifecycleReferenceLogs(reference.before, reference.after))
            );
            expect(orderedSemanticLogStreams(after.logs)).toEqual(orderedSemanticLogStreams(expected.after.logs));
            const persistedActionTexts = after.logs
                .filter((entry) => String(entry.category).toLowerCase() === 'action')
                .map((entry) => normalizeStoredTurnLogText(entry.text));
            expect(persistedActionTexts.findIndex((text) => text.includes('국호를'))).toBeLessThan(
                persistedActionTexts.findIndex((text) => text.includes('훈련치가'))
            );

            const reloaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
            const reloadedActor = reloaded.snapshot.generals.find((general) => general.id === request.actorGeneralId);
            const expectedActor = expected.after.generals.find((general) => general.id === request.actorGeneralId);
            expect(reloadedActor).toMatchObject({
                train: expectedActor?.train,
                atmos: expectedActor?.atmos,
                experience: expectedActor?.experience,
                dedication: expectedActor?.dedication,
            });
            expect(asRecord(reloadedActor?.meta)).toMatchObject({
                killturn: expectedActor?.killTurn,
                myset: expectedActor?.mySet,
            });
            expect(reloaded.snapshot.nations.find((nation) => nation.id === actor.nationId)?.name).toBe('수명주기국');

            const reloadedReservedTurns = new InMemoryReservedTurnStore(db, {
                maxGeneralTurns: 30,
                maxNationTurns: 12,
            });
            await reloadedReservedTurns.loadAll();
            expect(reloadedReservedTurns.getGeneralTurn(actor.id, 0).action).toBe('휴식');
            expect(reloadedReservedTurns.getNationTurn(actor.nationId, actor.officerLevel, 0).action).toBe('휴식');
        },
        180_000
    );

    it('persists thirty resting turns for every command-created volunteer and reloads them', async () => {
        if (!db) {
            throw new Error('fixture database is not connected');
        }
        const map = await loadMapDefinitionByName('che');
        const unitSet = await loadUnitSetDefinitionByName('che');
        const cityDefinition = map.cities.find((city) => city.id === 3) ?? map.cities[0];
        if (!cityDefinition) {
            throw new Error('fixture map has no city');
        }
        const actorId = 101;
        const nationId = 11;
        const actionTime = new Date('0190-01-01T00:00:00.000Z');
        const actor: TurnGeneral = {
            id: actorId,
            userId: null,
            name: '영속화의병장',
            nationId,
            cityId: cityDefinition.id,
            troopId: 0,
            stats: { leadership: 90, strength: 80, intelligence: 70 },
            experience: 1_000,
            dedication: 1_000,
            officerLevel: 12,
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null },
            },
            injury: 0,
            gold: 100_000,
            rice: 100_000,
            crew: 1_000,
            crewTypeId: 1_100,
            train: 50,
            atmos: 50,
            age: 30,
            npcState: 0,
            bornYear: 160,
            deadYear: 260,
            affinity: 50,
            picture: 'default.jpg',
            imageServer: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {
                killturn: 24,
                officer_city: cityDefinition.id,
                belong: 10,
                permission: 'normal',
            },
            turnTime: actionTime,
        };
        const state: TurnWorldState = {
            id: 1,
            currentYear: 190,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: actionTime,
            clockBaseTime: actionTime,
            clockTick: 0,
            clockMode: 'manual',
            clockWallAnchor: actionTime,
            lastTurnTick: 0,
            meta: {
                hiddenSeed: 'turn-command-volunteer-persistence',
                killturn: 24,
                lastTurnTime: actionTime.toISOString(),
            },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {
                    develCost: 100,
                    openingPartYear: 3,
                    defaultMaxGeneral: 500,
                    initialNationGenLimit: 10,
                    defaultNpcGold: 1_000,
                    defaultNpcRice: 1_000,
                    defaultCrewTypeId: 1_100,
                    retirementYear: 80,
                    randGenFirstName: ['가'],
                    randGenMiddleName: [''],
                    randGenLastName: ['가'],
                    availablePersonality: ['che_안전'],
                },
                environment: { mapName: map.id, unitSet: unitSet.id },
            },
            scenarioMeta: {
                title: '명령 생성 장수 예약 턴 영속화',
                startYear: 180,
                life: null,
                fiction: 0,
                history: [],
                ignoreDefaultEvents: false,
            },
            map,
            unitSet,
            nations: [
                {
                    id: nationId,
                    name: '의병국',
                    color: '#777777',
                    capitalCityId: cityDefinition.id,
                    chiefGeneralId: actorId,
                    gold: 1_000_000,
                    rice: 1_000_000,
                    power: 0,
                    level: 1,
                    typeCode: 'che_명가',
                    meta: {
                        gennum: 1,
                        tech: 1_000,
                        strategic_cmd_limit: 0,
                        turn_last_12: { command: '의병모집', arg: {}, term: 2 },
                    },
                },
            ],
            cities: [
                {
                    id: cityDefinition.id,
                    name: cityDefinition.name,
                    nationId,
                    level: cityDefinition.level,
                    state: 0,
                    population: cityDefinition.initial.population,
                    populationMax: cityDefinition.max.population,
                    agriculture: cityDefinition.initial.agriculture,
                    agricultureMax: cityDefinition.max.agriculture,
                    commerce: cityDefinition.initial.commerce,
                    commerceMax: cityDefinition.max.commerce,
                    security: cityDefinition.initial.security,
                    securityMax: cityDefinition.max.security,
                    supplyState: map.defaults?.supplyState ?? 1,
                    frontState: map.defaults?.frontState ?? 0,
                    defence: cityDefinition.initial.defence,
                    defenceMax: cityDefinition.max.defence,
                    wall: cityDefinition.initial.wall,
                    wallMax: cityDefinition.max.wall,
                    conflict: {},
                    meta: {
                        trust: map.defaults?.trust ?? 50,
                        trade: map.defaults?.trade ?? 100,
                        region: cityDefinition.region,
                    },
                },
            ],
            generals: [actor],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };
        await seedCoreTurnCommandPersistenceFixture(db, {
            worldInput: { state, snapshot, map },
            scenarioCode: 'turn-command-volunteer-persistence',
            generalTurns: Array.from({ length: 30 }, (_, turnIndex) => ({
                generalId: actorId,
                turnIndex,
                action: '휴식',
                args: {},
            })),
            nationTurns: Array.from({ length: 12 }, (_, turnIndex) => ({
                nationId,
                officerLevel: 12,
                turnIndex,
                action: turnIndex === 0 ? 'che_의병모집' : '휴식',
                args: {},
            })),
        });

        const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        const reservedTurns = new InMemoryReservedTurnStore(db, {
            maxGeneralTurns: 30,
            maxNationTurns: 12,
            leaseOwner: `${leaseOwner}-volunteer`,
            leaseDurationMs: 60_000,
        });
        await reservedTurns.loadAll();
        const loadedActor = loaded.snapshot.generals.find((general) => general.id === actorId);
        if (!loadedActor) {
            throw new Error('volunteer fixture actor is missing after database load');
        }
        await reservedTurns.prepareTurnsForExecution(actorId, { nationId, officerLevel: 12 });

        let world: InMemoryTurnWorld | null = null;
        const handler = await createReservedTurnHandler({
            reservedTurns,
            scenarioConfig: loaded.snapshot.scenarioConfig,
            scenarioMeta: loaded.snapshot.scenarioMeta,
            map: loaded.snapshot.map,
            unitSet: loaded.snapshot.unitSet,
            getWorld: () => world,
            now: () => new Date(loaded.state.lastTurnTime),
            commandProfile: {
                general: ['휴식'],
                nation: ['che_의병모집', '휴식'],
            },
        });
        world = new InMemoryTurnWorld(loaded.state, loaded.snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            generalTurnHandler: handler,
        });
        const executableActor = world.getGeneralById(actorId);
        if (!executableActor) {
            throw new Error('volunteer fixture actor is missing from executable world');
        }
        world.executeGeneralTurn(executableActor);

        const createdGenerals = world.peekDirtyState().createdGenerals;
        const createdIds = createdGenerals.map((general) => general.id).sort((left, right) => left - right);
        expect(createdIds).toEqual([102, 103, 104]);
        const createdVolunteerIdentity = createdGenerals
            .map((general) => ({
                id: general.id,
                affinity: general.affinity,
                npcState: general.npcState,
                npcOrg: asRecord(general.meta).npc_org,
                expLevel: asRecord(general.meta).explevel,
                dedLevel: asRecord(general.meta).dedlevel,
            }))
            .sort((left, right) => left.id - right.id);
        expect(createdVolunteerIdentity).toEqual(
            createdIds.map((id) => ({
                id,
                affinity: expect.any(Number),
                npcState: 4,
                npcOrg: 4,
                expLevel: 0,
                dedLevel: 1,
            }))
        );
        for (const volunteer of createdVolunteerIdentity) {
            expect(volunteer.affinity).toBeGreaterThanOrEqual(1);
            expect(volunteer.affinity).toBeLessThanOrEqual(150);
        }
        expect(reservedTurns.peekDirtyState().generalInitializationIds.sort((left, right) => left - right)).toEqual(
            createdIds
        );
        const restingTurns = Array.from({ length: 30 }, () => ({ action: '휴식', args: {} }));
        for (const generalId of createdIds) {
            expect(reservedTurns.getGeneralTurns(generalId)).toEqual(restingTurns);
        }

        const hooks = await createDatabaseTurnHooks(databaseUrl!, world, { reservedTurns });
        try {
            if (!hooks.hooks.flushChanges) {
                throw new Error('database turn hooks do not expose flushChanges');
            }
            await hooks.hooks.flushChanges({
                lastTurnTime: loaded.state.lastTurnTime.toISOString(),
                processedGenerals: 1,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });
        } finally {
            await hooks.close();
        }

        const persistedTurns = await db.generalTurn.findMany({
            where: { generalId: { in: createdIds } },
            orderBy: [{ generalId: 'asc' }, { turnIdx: 'asc' }],
        });
        expect(persistedTurns).toHaveLength(createdIds.length * 30);
        for (const generalId of createdIds) {
            expect(
                persistedTurns
                    .filter((turn) => turn.generalId === generalId)
                    .map((turn) => ({ turnIdx: turn.turnIdx, action: turn.actionCode, args: turn.arg }))
            ).toEqual(Array.from({ length: 30 }, (_, turnIdx) => ({ turnIdx, action: '휴식', args: {} })));
        }

        const persistedVolunteerIdentity = (
            await db.general.findMany({
                where: { id: { in: createdIds } },
                select: { id: true, affinity: true, npcState: true, meta: true },
                orderBy: { id: 'asc' },
            })
        ).map((general) => ({
            id: general.id,
            affinity: general.affinity,
            npcState: general.npcState,
            npcOrg: asRecord(general.meta).npc_org,
            expLevel: asRecord(general.meta).explevel,
            dedLevel: asRecord(general.meta).dedlevel,
        }));
        expect(persistedVolunteerIdentity).toEqual(createdVolunteerIdentity);

        const persistedNation = await db.nation.findUnique({ where: { id: nationId }, select: { meta: true } });
        expect(persistedNation?.meta).toMatchObject({ gennum: 4 });

        const reloaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        expect(
            reloaded.snapshot.generals
                .filter((general) => createdIds.includes(general.id))
                .map((general) => ({
                    id: general.id,
                    affinity: general.affinity,
                    npcState: general.npcState,
                    npcOrg: asRecord(general.meta).npc_org,
                    expLevel: asRecord(general.meta).explevel,
                    dedLevel: asRecord(general.meta).dedlevel,
                }))
                .sort((left, right) => left.id - right.id)
        ).toEqual(createdVolunteerIdentity);
        expect(reloaded.snapshot.nations.find((nation) => nation.id === nationId)?.meta).toMatchObject({ gennum: 4 });
        const reloadedReservedTurns = new InMemoryReservedTurnStore(db, {
            maxGeneralTurns: 30,
            maxNationTurns: 12,
        });
        await reloadedReservedTurns.loadAll();
        for (const generalId of createdIds) {
            expect(reloadedReservedTurns.getGeneralTurns(generalId)).toEqual(restingTurns);
        }
    }, 180_000);
});
