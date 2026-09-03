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
const worldId = 992_310;
const actorGeneralId = 7_310;
const targetGeneralId = 7_311;
const nationId = 7_312;
const actorUserId = 'inheritance-atomic-actor';
const targetUserId = 'inheritance-atomic-target';
const requestPrefix = 'integration:inheritance-atomic';
const pointConstraint = 'inheritance_atomic_point_failure';
const rankConstraint = 'inheritance_atomic_rank_failure';
const logConstraint = 'inheritance_atomic_log_failure';
const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };

const scenarioConfig: ScenarioConfig = {
    stat: { total: 200, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
    iconPath: '.',
    map: {},
    const: {
        inheritBornStatPoint: 1_000,
        inheritItemRandomPoint: 3_000,
        inheritBuffPoints: [0, 200, 600, 1_200, 2_000, 3_000],
        inheritSpecificSpecialPoint: 4_000,
        inheritResetAttrPointBase: [1_000, 1_000, 2_000, 3_000],
        inheritCheckOwnerPoint: 1_000,
        availableSpecialWar: ['che_의술'],
    },
    environment: { mapName: 'che', unitSet: 'che' },
};
const scenarioMeta: ScenarioMeta = {
    title: '유산 원자성 통합',
    startYear: 200,
    life: null,
    fiction: null,
    history: [],
    ignoreDefaultEvents: false,
};
const map: MapDefinition = { id: 'inheritance-atomic', name: scenarioMeta.title, cities: [] };
const state: TurnWorldState = {
    id: worldId,
    currentYear: 200,
    currentMonth: 4,
    tickSeconds: 600,
    lastTurnTime: new Date('2026-08-24T00:00:00.000Z'),
    meta: { hiddenSeed: 'inheritance-atomic-seed', season: 77, isunited: 0, scenarioMeta },
};

const buildGeneral = (overrides: Partial<TurnGeneral>): TurnGeneral => ({
    id: actorGeneralId,
    userId: actorUserId,
    name: '확인장수',
    nationId,
    cityId: 0,
    troopId: 0,
    stats: { leadership: 70, strength: 45, intelligence: 85 },
    turnTime: new Date('2026-08-24T00:10:00.000Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24, inherit_spent_dyn: 17 },
    inheritancePoints: { previous: 10_000 },
    penalty: {},
    officerLevel: 1,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
    ...overrides,
});
const actorGeneral = buildGeneral({});
const targetGeneral = buildGeneral({
    id: targetGeneralId,
    userId: targetUserId,
    name: '피확인장수',
    meta: { killturn: 24, owner_name: '레거시 소유자' },
    inheritancePoints: { previous: 0 },
});
const generals = [actorGeneral, targetGeneral];

const assertDedicatedDatabase = (rawUrl: string): void => {
    const schema = new URL(rawUrl).searchParams.get('schema');
    if (!schema?.endsWith('immediate_action_integration')) {
        throw new Error(`Refusing to mutate non-dedicated schema: ${schema ?? '(missing)'}`);
    }
};

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
    meta: general.meta as GamePrisma.InputJsonValue,
    penalty: general.penalty as GamePrisma.InputJsonValue,
});

const buildCommand = (
    suffix: string,
    input: Extract<TurnDaemonCommand, { type: 'inheritanceAction' }>['input']
): Extract<TurnDaemonCommand, { type: 'inheritanceAction' }> => ({
    type: 'inheritanceAction',
    requestId: `${requestPrefix}:${suffix}`,
    userId: actorUserId,
    input,
});

integration('inheritance action PostgreSQL atomic persistence', () => {
    let db: GamePrismaClient;
    let disconnect: (() => Promise<void>) | undefined;
    let hooks: DatabaseTurnHooks | undefined;

    const dropFailureConstraints = async (): Promise<void> => {
        await db.$executeRawUnsafe(`ALTER TABLE inheritance_point DROP CONSTRAINT IF EXISTS ${pointConstraint}`);
        await db.$executeRawUnsafe(`ALTER TABLE rank_data DROP CONSTRAINT IF EXISTS ${rankConstraint}`);
        await db.$executeRawUnsafe(`ALTER TABLE inheritance_log DROP CONSTRAINT IF EXISTS ${logConstraint}`);
    };

    beforeAll(async () => {
        assertDedicatedDatabase(databaseUrl!);
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnect = () => connector.disconnect();
        await dropFailureConstraints();
        await db.inputEvent.deleteMany({ where: { requestId: { startsWith: requestPrefix } } });
        await db.message.deleteMany({ where: { mailbox: { in: [actorGeneralId, targetGeneralId] } } });
        await db.inheritanceLog.deleteMany({ where: { userId: { in: [actorUserId, targetUserId] } } });
        await db.inheritanceUserState.deleteMany({ where: { userId: { in: [actorUserId, targetUserId] } } });
        await db.inheritancePoint.deleteMany({ where: { userId: { in: [actorUserId, targetUserId] } } });
        await db.rankData.deleteMany({ where: { generalId: { in: [actorGeneralId, targetGeneralId] } } });
        await db.general.deleteMany({ where: { id: { in: [actorGeneralId, targetGeneralId] } } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await db.worldState.deleteMany({ where: { id: worldId } });

        await db.worldState.create({
            data: {
                id: worldId,
                scenarioCode: 'inheritance-atomic',
                currentYear: state.currentYear,
                currentMonth: state.currentMonth,
                tickSeconds: state.tickSeconds,
                config: JSON.parse(JSON.stringify(scenarioConfig)) as GamePrisma.InputJsonValue,
                meta: state.meta as GamePrisma.InputJsonValue,
            },
        });
        await db.nation.create({ data: { id: nationId, name: '통합국', color: '#123456', level: 1 } });
        await db.general.createMany({ data: generals.map(toGeneralCreate) });
        await db.inheritancePoint.create({ data: { userId: actorUserId, key: 'previous', value: 10_000 } });
        await db.rankData.create({
            data: { generalId: actorGeneralId, nationId, type: 'inherit_spent_dyn', value: 17 },
        });
    });

    afterAll(async () => {
        await hooks?.close();
        if (db) {
            await dropFailureConstraints();
            await db.inputEvent.deleteMany({ where: { requestId: { startsWith: requestPrefix } } });
            await db.message.deleteMany({ where: { mailbox: { in: [actorGeneralId, targetGeneralId] } } });
            await db.inheritanceLog.deleteMany({ where: { userId: { in: [actorUserId, targetUserId] } } });
            await db.inheritanceUserState.deleteMany({ where: { userId: { in: [actorUserId, targetUserId] } } });
            await db.inheritancePoint.deleteMany({ where: { userId: { in: [actorUserId, targetUserId] } } });
            await db.rankData.deleteMany({ where: { generalId: { in: [actorGeneralId, targetGeneralId] } } });
            await db.general.deleteMany({ where: { id: { in: [actorGeneralId, targetGeneralId] } } });
            await db.nation.deleteMany({ where: { id: nationId } });
            await db.worldState.deleteMany({ where: { id: worldId } });
        }
        await disconnect?.();
    });

    it('rolls patch/point/rank/log/messages back at each injected failure and reloads one committed mutation', async () => {
        const snapshot: TurnWorldSnapshot = {
            generals,
            cities: [],
            nations: [
                {
                    id: nationId,
                    name: '통합국',
                    color: '#123456',
                    capitalCityId: null,
                    chiefGeneralId: actorGeneralId,
                    gold: 0,
                    rice: 0,
                    power: 0,
                    level: 1,
                    typeCode: 'che_def',
                    meta: {},
                },
            ],
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
            command: Extract<TurnDaemonCommand, { type: 'inheritanceAction' }>
        ): Promise<TurnDaemonCommandResult> => {
            if (!hooks?.hooks.executeCommand || !command.requestId) {
                throw new Error('Database command execution hook is unavailable.');
            }
            return stateManager.transaction(() =>
                hooks!.hooks.executeCommand!(command.requestId!, async (context) => {
                    const result = await handler.handle(command, context);
                    if (!result) throw new Error('inheritanceAction command was not handled.');
                    return result;
                })
            );
        };
        const createInputEvent = async (
            command: Extract<TurnDaemonCommand, { type: 'inheritanceAction' }>
        ): Promise<void> => {
            const clock = world.getGameClockState();
            await db.inputEvent.create({
                data: {
                    requestId: command.requestId!,
                    target: 'ENGINE',
                    eventType: command.type,
                    actorUserId: command.userId,
                    status: 'PROCESSING',
                    lockedBy: 'inheritance-atomic-worker',
                    leaseUntil: new Date('2026-08-24T01:00:00.000Z'),
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
        const assertStored = async (point: number, spent: number, logCount: number, messageCount: number) => {
            await expect(
                db.inheritancePoint.findUniqueOrThrow({
                    where: { userId_key: { userId: actorUserId, key: 'previous' } },
                })
            ).resolves.toMatchObject({ value: point });
            await expect(
                db.rankData.findUniqueOrThrow({
                    where: { generalId_type: { generalId: actorGeneralId, type: 'inherit_spent_dyn' } },
                })
            ).resolves.toMatchObject({ value: spent });
            await expect(db.inheritanceLog.count({ where: { userId: actorUserId } })).resolves.toBe(logCount);
            await expect(
                db.message.count({ where: { mailbox: { in: [actorGeneralId, targetGeneralId] } } })
            ).resolves.toBe(messageCount);
        };

        const pointCommand = buildCommand('point', {
            action: 'buyHiddenBuff',
            buffType: 'warAvoidRatio',
            level: 1,
        });
        await createInputEvent(pointCommand);
        await db.$executeRawUnsafe(`
            ALTER TABLE inheritance_point
            ADD CONSTRAINT ${pointConstraint}
            CHECK (user_id <> '${actorUserId}' OR key <> 'previous' OR value = 10000)
        `);
        await expect(execute(pointCommand)).rejects.toThrow(`violates check constraint "${pointConstraint}"`);
        expect(world.getGeneralById(actorGeneralId)?.meta).toMatchObject({ inherit_spent_dyn: 17 });
        expect(world.getGeneralById(actorGeneralId)?.meta).not.toHaveProperty('inheritBuff');
        await assertStored(10_000, 17, 0, 0);
        await expect(
            db.inputEvent.findUniqueOrThrow({ where: { requestId: pointCommand.requestId! } })
        ).resolves.toMatchObject({
            status: 'PROCESSING',
            result: null,
        });
        await db.$executeRawUnsafe(`ALTER TABLE inheritance_point DROP CONSTRAINT ${pointConstraint}`);
        await expect(execute(pointCommand)).resolves.toMatchObject({ ok: true, remainPoint: 9_800 });
        await assertStored(9_800, 217, 1, 0);

        const rankCommand = buildCommand('rank', { action: 'checkOwner', targetGeneralId });
        await createInputEvent(rankCommand);
        await db.$executeRawUnsafe(`
            ALTER TABLE rank_data
            ADD CONSTRAINT ${rankConstraint}
            CHECK (general_id <> ${actorGeneralId} OR type <> 'inherit_spent_dyn' OR value = 217)
        `);
        await expect(execute(rankCommand)).rejects.toThrow(`violates check constraint "${rankConstraint}"`);
        expect(world.peekDirtyState().messages).toEqual([]);
        await assertStored(9_800, 217, 1, 0);
        await db.$executeRawUnsafe(`ALTER TABLE rank_data DROP CONSTRAINT ${rankConstraint}`);
        await expect(execute(rankCommand)).resolves.toMatchObject({
            ok: true,
            remainPoint: 8_800,
            ownerName: '레거시 소유자',
        });
        await assertStored(8_800, 1_217, 2, 2);

        const currentLog = await db.inheritanceLog.findFirstOrThrow({
            where: { userId: actorUserId },
            orderBy: { id: 'desc' },
            select: { id: true },
        });
        const logCommand = buildCommand('log', { action: 'buyRandomUnique' });
        await createInputEvent(logCommand);
        await db.$executeRawUnsafe(`
            ALTER TABLE inheritance_log
            ADD CONSTRAINT ${logConstraint}
            CHECK (user_id <> '${actorUserId}' OR id <= ${currentLog.id})
        `);
        await expect(execute(logCommand)).rejects.toThrow(`violates check constraint "${logConstraint}"`);
        expect(world.getGeneralById(actorGeneralId)?.meta).not.toHaveProperty('inheritRandomUnique');
        await assertStored(8_800, 1_217, 2, 2);
        await db.$executeRawUnsafe(`ALTER TABLE inheritance_log DROP CONSTRAINT ${logConstraint}`);
        await expect(execute(logCommand)).resolves.toMatchObject({ ok: true, remainPoint: 5_800 });
        await assertStored(5_800, 4_217, 3, 2);

        const freeStatCommand = buildCommand('free-stat', {
            action: 'resetStat',
            leadership: 70,
            strength: 45,
            intel: 85,
            inheritBonusStat: [0, 0, 0],
        });
        await createInputEvent(freeStatCommand);
        await expect(execute(freeStatCommand)).resolves.toMatchObject({ ok: true, remainPoint: 5_800 });
        await assertStored(5_800, 4_217, 5, 2);

        const messages = await db.message.findMany({
            where: { mailbox: { in: [actorGeneralId, targetGeneralId] } },
            orderBy: { id: 'asc' },
            select: { mailbox: true, message: true },
        });
        expect(messages.map((entry) => [entry.mailbox, (entry.message as { text: string }).text])).toEqual([
            [actorGeneralId, '피확인장수의 소유자는 레거시 소유자 입니다.'],
            [targetGeneralId, '소유자명이 누군가에 의해 확인되었습니다.'],
        ]);
        await expect(
            db.inputEvent.findUniqueOrThrow({ where: { requestId: rankCommand.requestId! } })
        ).resolves.toMatchObject({
            status: 'SUCCEEDED',
            attempts: 1,
            result: expect.objectContaining({ type: 'inheritanceAction', ok: true, action: 'checkOwner' }),
            lockedBy: null,
        });

        const reloaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        expect(reloaded.snapshot.generals.find((general) => general.id === actorGeneralId)).toMatchObject({
            stats: { leadership: 71, strength: 47, intelligence: 86 },
            meta: {
                inherit_spent_dyn: 4_217,
                inheritRandomUnique: 1,
                inheritBuff: JSON.stringify({ warAvoidRatio: 1 }),
            },
            inheritancePoints: { previous: 5_800 },
        });
    }, 30_000);
});
