import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TurnDaemonCommand, TurnDaemonCommandResult } from '@sammo-ts/common';
import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';
import type { MapDefinition, ScenarioConfig, ScenarioMeta, TurnSchedule } from '@sammo-ts/logic';

import { createDatabaseTurnHooks, type DatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { EngineStateManager } from '../src/turn/engineStateManager.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';
import { loadTurnWorldFromDatabase } from '../src/turn/worldLoader.js';

const databaseUrl = process.env.IMMEDIATE_ACTION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const worldId = 991_741;
const targetGeneralId = 991_741;
const npcGeneralId = 991_742;
const foreignGeneralId = 991_743;
const rollbackRequestId = 'integration:engine:account-icon:rollback';
const actorMismatchRequestId = 'integration:engine:account-icon:actor-mismatch';
const successRequestId = 'integration:engine:account-icon:success';
const noGeneralRequestId = 'integration:engine:account-icon:no-general';
const rollbackConstraint = 'account_icon_rollback_test';
const targetUserId = 'account-icon-target-user';
const npcUserId = 'account-icon-npc-user';
const foreignUserId = 'account-icon-foreign-user';
const initialPicture = 'account-icon-old.jpg';
const initialImageServer = 0;
const nextPicture = 'account-icon-new.png';
const nextImageServer = 1;
const rollbackRevision = '2026-07-31T09:05:00.000Z';
const successRevision = '2026-07-31T09:10:00.000Z';
const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };

const assertDedicatedDatabase = (rawUrl: string): void => {
    const schema = new URL(rawUrl).searchParams.get('schema');
    if (!schema?.endsWith('immediate_action_integration')) {
        throw new Error(`Refusing to mutate non-dedicated schema: ${schema ?? '(missing)'}`);
    }
};

const scenarioConfig: ScenarioConfig = {
    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 65 },
    iconPath: '',
    map: {},
    const: {},
    environment: {
        mapName: 'che',
        unitSet: 'che',
    },
};

const scenarioMeta: ScenarioMeta = {
    title: '계정 아이콘 영속성 통합',
    startYear: 190,
    life: null,
    fiction: null,
    history: [],
    ignoreDefaultEvents: false,
};

const map: MapDefinition = {
    id: 'account-icon-integration',
    name: '계정 아이콘 영속성 통합',
    cities: [],
};

const state: TurnWorldState = {
    id: worldId,
    currentYear: 190,
    currentMonth: 1,
    tickSeconds: 600,
    lastTurnTime: new Date('2026-07-31T09:00:00.000Z'),
    meta: {
        killturn: 24,
        lastTurnTime: '2026-07-31T09:00:00.000Z',
        scenarioMeta,
    },
};

const buildGeneral = (overrides: Partial<TurnGeneral>): TurnGeneral => ({
    id: targetGeneralId,
    userId: targetUserId,
    name: '아이콘통합장수',
    nationId: 0,
    cityId: 0,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    turnTime: new Date('2026-07-31T09:10:00.000Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24, preserved: 'yes' },
    penalty: {},
    officerLevel: 0,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 20,
    npcState: 0,
    picture: initialPicture,
    imageServer: initialImageServer,
    ...overrides,
});

const targetGeneral = buildGeneral({});
const npcGeneral = buildGeneral({
    id: npcGeneralId,
    userId: npcUserId,
    name: '빙의NPC',
    npcState: 1,
});
const foreignGeneral = buildGeneral({
    id: foreignGeneralId,
    userId: foreignUserId,
    name: '타사용자장수',
});
const generals = [targetGeneral, npcGeneral, foreignGeneral];

const buildCommand = (
    requestId: string,
    userId: string,
    iconRevision: string,
    picture = nextPicture,
    imageServer = nextImageServer
): Extract<TurnDaemonCommand, { type: 'adjustGeneralIcon' }> => ({
    type: 'adjustGeneralIcon',
    requestId,
    userId,
    picture,
    imageServer,
    iconRevision,
});

const toGeneralCreate = (general: TurnGeneral): GamePrisma.GeneralCreateManyInput => ({
    id: general.id,
    userId: general.userId,
    name: general.name,
    nationId: general.nationId,
    cityId: general.cityId,
    troopId: general.troopId,
    npcState: general.npcState,
    leadership: general.stats.leadership,
    strength: general.stats.strength,
    intel: general.stats.intelligence,
    officerLevel: general.officerLevel,
    experience: general.experience,
    dedication: general.dedication,
    injury: general.injury,
    gold: general.gold,
    rice: general.rice,
    crew: general.crew,
    crewTypeId: general.crewTypeId,
    train: general.train,
    atmos: general.atmos,
    turnTime: general.turnTime,
    recentWarTime: general.recentWarTime,
    age: general.age,
    picture: general.picture,
    imageServer: general.imageServer,
    meta: general.meta as GamePrisma.InputJsonValue,
    penalty: general.penalty as GamePrisma.InputJsonValue,
});

integration('adjustGeneralIcon PostgreSQL persistence', () => {
    let db: GamePrismaClient;
    let disconnect: (() => Promise<void>) | undefined;
    let hooks: DatabaseTurnHooks | undefined;

    beforeAll(async () => {
        assertDedicatedDatabase(databaseUrl!);
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnect = () => connector.disconnect();

        await db.$executeRawUnsafe(`ALTER TABLE input_event DROP CONSTRAINT IF EXISTS ${rollbackConstraint}`);
        await db.inputEvent.deleteMany({
            where: {
                requestId: {
                    in: [rollbackRequestId, actorMismatchRequestId, successRequestId, noGeneralRequestId],
                },
            },
        });
        await db.rankData.deleteMany({
            where: { generalId: { in: generals.map((general) => general.id) } },
        });
        await db.general.deleteMany({
            where: { id: { in: generals.map((general) => general.id) } },
        });
        await db.worldState.deleteMany({ where: { id: worldId } });

        await db.worldState.create({
            data: {
                id: worldId,
                scenarioCode: 'account-icon-integration',
                currentYear: state.currentYear,
                currentMonth: state.currentMonth,
                tickSeconds: state.tickSeconds,
                config: JSON.parse(JSON.stringify(scenarioConfig)) as GamePrisma.InputJsonValue,
                meta: state.meta as GamePrisma.InputJsonValue,
            },
        });
        await db.general.createMany({
            data: generals.map(toGeneralCreate),
        });
    });

    afterAll(async () => {
        await hooks?.close();
        if (!db) {
            await disconnect?.();
            return;
        }
        await db.$executeRawUnsafe(`ALTER TABLE input_event DROP CONSTRAINT IF EXISTS ${rollbackConstraint}`);
        await db.inputEvent.deleteMany({
            where: {
                requestId: {
                    in: [rollbackRequestId, actorMismatchRequestId, successRequestId, noGeneralRequestId],
                },
            },
        });
        await db.rankData.deleteMany({
            where: { generalId: { in: generals.map((general) => general.id) } },
        });
        await db.general.deleteMany({
            where: { id: { in: generals.map((general) => general.id) } },
        });
        await db.worldState.deleteMany({ where: { id: worldId } });
        await disconnect?.();
    });

    it('commits the authenticated human icon with input_event and rolls both back on failure', async () => {
        const snapshot: TurnWorldSnapshot = {
            generals,
            cities: [],
            nations: [],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            scenarioConfig,
            scenarioMeta,
            map,
        };
        const world = new InMemoryTurnWorld(state, snapshot, { schedule });
        const handler = createTurnDaemonCommandHandler({ world });
        hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        const stateManager = new EngineStateManager();
        stateManager.register('world', {
            capture: () => world.captureState(),
            restore: (captured) => world.restoreState(captured),
        });
        const execute = async (
            command: Extract<TurnDaemonCommand, { type: 'adjustGeneralIcon' }>
        ): Promise<TurnDaemonCommandResult> => {
            if (!hooks?.hooks.executeCommand || !command.requestId) {
                throw new Error('Database command execution hook is unavailable.');
            }
            return stateManager.transaction(() =>
                hooks!.hooks.executeCommand!(command.requestId!, async (context) => {
                    const result = await handler.handle(command, context);
                    if (!result) {
                        throw new Error('adjustGeneralIcon command was not handled.');
                    }
                    return result;
                })
            );
        };
        const createInputEvent = async (
            command: Extract<TurnDaemonCommand, { type: 'adjustGeneralIcon' }>,
            actorUserId = command.userId
        ): Promise<void> => {
            const clock = world.getGameClockState();
            await db.inputEvent.create({
                data: {
                    requestId: command.requestId!,
                    target: 'ENGINE',
                    eventType: command.type,
                    actorUserId,
                    status: 'PROCESSING',
                    lockedBy: 'account-icon-integration-worker',
                    leaseUntil: new Date('2026-07-31T09:30:00.000Z'),
                    attempts: 1,
                    payload: command as GamePrisma.InputJsonValue,
                    acceptedGameTick: BigInt(clock.tick),
                    acceptedClockRevision: BigInt(clock.revision),
                    acceptedDeadlineGeneration: BigInt(clock.deadlineGeneration),
                    processingGameTick: BigInt(clock.tick),
                    processingClockRevision: BigInt(clock.revision),
                    processingDeadlineGeneration: BigInt(clock.deadlineGeneration),
                },
            });
        };

        const rollbackCommand = buildCommand(rollbackRequestId, targetUserId, rollbackRevision, 'must-rollback.png', 7);
        await createInputEvent(rollbackCommand);
        await db.$executeRawUnsafe(`
            ALTER TABLE input_event
            ADD CONSTRAINT ${rollbackConstraint}
            CHECK (request_id <> '${rollbackRequestId}' OR status <> 'SUCCEEDED')
        `);
        await expect(execute(rollbackCommand)).rejects.toThrow(`violates check constraint "${rollbackConstraint}"`);
        expect(hooks.takeCommittedReadModelChanges()).toBeNull();
        expect(world.getGeneralById(targetGeneralId)).toMatchObject({
            picture: initialPicture,
            imageServer: initialImageServer,
            meta: { killturn: 24, preserved: 'yes' },
        });
        await expect(db.general.findUniqueOrThrow({ where: { id: targetGeneralId } })).resolves.toMatchObject({
            picture: initialPicture,
            imageServer: initialImageServer,
            meta: { killturn: 24, preserved: 'yes' },
        });
        await expect(
            db.inputEvent.findUniqueOrThrow({ where: { requestId: rollbackRequestId } })
        ).resolves.toMatchObject({
            status: 'PROCESSING',
            result: null,
            lockedBy: 'account-icon-integration-worker',
        });
        await db.$executeRawUnsafe(`ALTER TABLE input_event DROP CONSTRAINT ${rollbackConstraint}`);

        const actorMismatchCommand = buildCommand(
            actorMismatchRequestId,
            targetUserId,
            rollbackRevision,
            'actor-mismatch.png',
            8
        );
        await createInputEvent(actorMismatchCommand, foreignUserId);
        await expect(execute(actorMismatchCommand)).rejects.toThrow('actor does not match');
        expect(hooks.takeCommittedReadModelChanges()).toBeNull();
        expect(world.getGeneralById(targetGeneralId)).toMatchObject({
            picture: initialPicture,
            imageServer: initialImageServer,
        });
        await expect(db.general.findUniqueOrThrow({ where: { id: targetGeneralId } })).resolves.toMatchObject({
            picture: initialPicture,
            imageServer: initialImageServer,
        });
        await expect(
            db.inputEvent.findUniqueOrThrow({ where: { requestId: actorMismatchRequestId } })
        ).resolves.toMatchObject({
            status: 'PROCESSING',
            result: null,
        });

        const successCommand = buildCommand(successRequestId, targetUserId, successRevision);
        await createInputEvent(successCommand);
        await expect(execute(successCommand)).resolves.toEqual({
            type: 'adjustGeneralIcon',
            ok: true,
            generalId: targetGeneralId,
            updated: true,
        });
        expect(hooks.takeCommittedReadModelChanges()).toMatchObject({
            generalIds: [targetGeneralId],
            mapGeneralIds: [],
            frontStatusGeneralIds: [],
            lobbyGeneralIds: [targetGeneralId],
            reservedGeneralIds: [],
        });
        expect(world.getGeneralById(targetGeneralId)).toMatchObject({
            picture: nextPicture,
            imageServer: nextImageServer,
            meta: {
                killturn: 24,
                preserved: 'yes',
                accountIconUpdatedAt: successRevision,
            },
        });
        expect(world.getGeneralById(npcGeneralId)).toMatchObject({
            picture: initialPicture,
            imageServer: initialImageServer,
        });
        expect(world.getGeneralById(foreignGeneralId)).toMatchObject({
            picture: initialPicture,
            imageServer: initialImageServer,
        });
        await expect(db.general.findUniqueOrThrow({ where: { id: targetGeneralId } })).resolves.toMatchObject({
            picture: nextPicture,
            imageServer: nextImageServer,
            meta: {
                killturn: 24,
                preserved: 'yes',
                accountIconUpdatedAt: successRevision,
            },
        });
        await expect(db.general.findUniqueOrThrow({ where: { id: npcGeneralId } })).resolves.toMatchObject({
            picture: initialPicture,
            imageServer: initialImageServer,
        });
        await expect(db.general.findUniqueOrThrow({ where: { id: foreignGeneralId } })).resolves.toMatchObject({
            picture: initialPicture,
            imageServer: initialImageServer,
        });
        await expect(
            db.inputEvent.findUniqueOrThrow({ where: { requestId: successRequestId } })
        ).resolves.toMatchObject({
            status: 'SUCCEEDED',
            result: {
                type: 'adjustGeneralIcon',
                ok: true,
                generalId: targetGeneralId,
                updated: true,
            },
            error: null,
            lockedBy: null,
            leaseUntil: null,
            completedAt: expect.any(Date),
        });

        const noGeneralCommand = buildCommand(noGeneralRequestId, npcUserId, successRevision, 'npc-must-stay.png', 9);
        await createInputEvent(noGeneralCommand);
        await expect(execute(noGeneralCommand)).resolves.toEqual({
            type: 'adjustGeneralIcon',
            ok: true,
            generalId: null,
            updated: false,
        });
        expect(world.getGeneralById(npcGeneralId)).toMatchObject({
            picture: initialPicture,
            imageServer: initialImageServer,
        });
        await expect(db.general.findUniqueOrThrow({ where: { id: npcGeneralId } })).resolves.toMatchObject({
            picture: initialPicture,
            imageServer: initialImageServer,
            meta: { killturn: 24, preserved: 'yes' },
        });
        await expect(
            db.inputEvent.findUniqueOrThrow({ where: { requestId: noGeneralRequestId } })
        ).resolves.toMatchObject({
            status: 'SUCCEEDED',
            result: {
                type: 'adjustGeneralIcon',
                ok: true,
                generalId: null,
                updated: false,
            },
        });

        const reloaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        expect(reloaded.snapshot.generals.find((entry) => entry.id === targetGeneralId)).toMatchObject({
            picture: nextPicture,
            imageServer: nextImageServer,
            meta: {
                killturn: 24,
                preserved: 'yes',
                accountIconUpdatedAt: successRevision,
            },
        });
        expect(reloaded.snapshot.generals.find((entry) => entry.id === npcGeneralId)).toMatchObject({
            picture: initialPicture,
            imageServer: initialImageServer,
            npcState: 1,
        });
        expect(reloaded.snapshot.generals.find((entry) => entry.id === foreignGeneralId)).toMatchObject({
            picture: initialPicture,
            imageServer: initialImageServer,
            userId: foreignUserId,
        });
    });
});
