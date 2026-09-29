import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readOfficeRequest, type TurnDaemonCommand } from '@sammo-ts/common';
import { createGamePostgresConnector, type GamePrismaClient, type GamePrisma } from '@sammo-ts/infra';
import { buildWorld } from './officeRequestFixture.js';
import { createDatabaseTurnHooks, type DatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { EngineStateManager } from '../src/turn/engineStateManager.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';
import { createCityOfficeRequestCalendarHandler } from '../src/turn/cityOfficeRequests.js';
import { loadTurnWorldFromDatabase } from '../src/turn/worldLoader.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const worldId = 992951;
const generalId = 992953;
const requestId = 'integration:city-office-request';
const constraint = 'city_office_request_rollback_test';
integration('city office request durable persistence', () => {
    let db: GamePrismaClient;
    let disconnect: (() => Promise<void>) | undefined;
    let hooks: DatabaseTurnHooks | undefined;
    beforeAll(async () => {
        const schema = new URL(databaseUrl!).searchParams.get('schema');
        if (!schema || !/^(ci_|office_requests)/.test(schema)) throw new Error('Dedicated integration schema required');
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnect = () => connector.disconnect();
        await db.$executeRawUnsafe(`ALTER TABLE input_event DROP CONSTRAINT IF EXISTS ${constraint}`);
        await db.inputEvent.deleteMany({ where: { requestId } });
        await db.logEntry.deleteMany({
            where: { OR: [{ nationId: worldId }, { generalId: { in: [worldId, worldId + 1, generalId] } }] },
        });
        await db.rankData.deleteMany({ where: { generalId: { in: [worldId, worldId + 1, generalId] } } });
        await db.general.deleteMany({ where: { id: { in: [worldId, worldId + 1, generalId] } } });
        await db.city.deleteMany({ where: { id: worldId } });
        await db.nation.deleteMany({ where: { id: worldId } });
        await db.worldState.deleteMany();
    });
    afterAll(async () => {
        await hooks?.close();
        await disconnect?.();
    });
    it('rolls back request and journal together, reloads pending state, then persists automatic appointment once', async () => {
        const base = buildWorld({});
        const state = {
            ...base.state,
            id: worldId,
            clockBaseTime: base.state.lastTurnTime,
            clockTick: 0,
            lastTurnTick: 0,
            clockMode: 'manual' as const,
            clockPhase: 'MANUAL' as const,
            clockRevision: 1,
            deadlineGeneration: 1,
            clockWallAnchor: base.state.lastTurnTime,
        };
        const snapshot = {
            ...base.snapshot,
            generals: base.snapshot.generals.map((g) => ({
                ...g,
                id: 992950 + g.id,
                nationId: worldId,
                cityId: worldId,
                userId: `user-${992950 + g.id}`,
            })),
            cities: base.snapshot.cities.map((c) => ({ ...c, id: worldId, nationId: worldId })),
            nations: base.snapshot.nations.map((n) => ({
                ...n,
                id: worldId,
                capitalCityId: worldId,
                chiefGeneralId: worldId,
            })),
            scenarioConfig: { ...base.snapshot.scenarioConfig!, environment: { mapName: 'che', unitSet: 'che' } },
        };
        await db.worldState.create({
            data: {
                id: worldId,
                scenarioCode: 'office-requests',
                currentYear: state.currentYear,
                currentMonth: state.currentMonth,
                tickSeconds: 600,
                clockBaseTime: state.clockBaseTime,
                clockTick: 0n,
                lastTurnTick: 0n,
                clockMode: 'manual',
                clockPhase: 'MANUAL',
                clockWallAnchor: state.clockWallAnchor,
                clockRevision: 1n,
                deadlineGeneration: 1n,
                config: JSON.parse(JSON.stringify(snapshot.scenarioConfig)) as GamePrisma.InputJsonValue,
                meta: state.meta as GamePrisma.InputJsonValue,
            },
        });
        await db.nation.create({
            data: {
                id: worldId,
                name: '위',
                color: '#777777',
                level: 3,
                gold: 10000,
                rice: 10000,
                tech: 0,
                typeCode: 'che_중립',
                capitalCityId: worldId,
                meta: {},
            },
        });
        await db.city.create({
            data: {
                id: worldId,
                name: '허창',
                nationId: worldId,
                level: 7,
                population: 1000,
                populationMax: 2000,
                agriculture: 1000,
                agricultureMax: 2000,
                commerce: 1000,
                commerceMax: 2000,
                security: 1000,
                securityMax: 2000,
                defence: 1000,
                defenceMax: 2000,
                wall: 1000,
                wallMax: 2000,
                trust: 80,
                trade: 100,
                region: 1,
                meta: {},
            },
        });
        await db.general.createMany({
            data: snapshot.generals.map((g) => ({
                id: g.id,
                userId: g.userId,
                name: g.name,
                nationId: g.nationId,
                cityId: g.cityId,
                npcState: g.npcState,
                officerLevel: g.officerLevel,
                leadership: g.stats.leadership,
                strength: g.stats.strength,
                intel: g.stats.intelligence,
                gold: g.gold,
                rice: g.rice,
                crew: g.crew,
                crewTypeId: g.crewTypeId,
                train: g.train,
                atmos: g.atmos,
                age: g.age,
                turnTime: g.turnTime,
                meta: g.meta,
            })),
        });
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        const handler = createTurnDaemonCommandHandler({ world });
        hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        const manager = new EngineStateManager();
        manager.register('world', {
            capture: () => world.captureState(),
            restore: (saved) => world.restoreState(saved),
        });
        const command: Extract<TurnDaemonCommand, { type: 'cityOfficeRequest' }> = {
            type: 'cityOfficeRequest',
            requestId,
            userId: `user-${generalId}`,
            generalId,
            action: 'request',
            officerLevel: 4,
        };
        await db.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: command.type,
                actorUserId: command.userId,
                status: 'PROCESSING',
                lockedBy: 'office-test',
                leaseUntil: new Date('2099-01-01'),
                attempts: 1,
                payload: command,
                acceptedGameTick: 0n,
                acceptedClockRevision: 1n,
                acceptedDeadlineGeneration: 1n,
                processingGameTick: 0n,
                processingClockRevision: 1n,
                processingDeadlineGeneration: 1n,
            },
        });
        const execute = () =>
            manager.transaction(() =>
                hooks!.hooks.executeCommand!(requestId, async (context) => {
                    const result = await handler.handle(command, context);
                    if (!result) throw new Error('Missing result');
                    return result;
                })
            );
        await db.$executeRawUnsafe(
            `ALTER TABLE input_event ADD CONSTRAINT ${constraint} CHECK (request_id <> '${requestId}' OR status <> 'SUCCEEDED')`
        );
        await expect(execute()).rejects.toThrow();
        expect(readOfficeRequest(world.getGeneralById(generalId)?.meta)).toBeNull();
        expect(readOfficeRequest((await db.general.findUniqueOrThrow({ where: { id: generalId } })).meta)).toBeNull();
        expect(hooks.takeCommittedReadModelChanges()).toBeNull();
        await db.$executeRawUnsafe(`ALTER TABLE input_event DROP CONSTRAINT ${constraint}`);
        await expect(execute()).resolves.toMatchObject({ type: 'cityOfficeRequest', ok: true });
        expect((await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).status).toBe('SUCCEEDED');
        expect(readOfficeRequest((await db.general.findUniqueOrThrow({ where: { id: generalId } })).meta)?.status).toBe(
            'pending'
        );
        expect(hooks.takeCommittedReadModelChanges()).toMatchObject({ frontStatusChanged: true });
        await hooks.close();
        const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        const reloaded: InMemoryTurnWorld = new InMemoryTurnWorld(loaded.state, loaded.snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createCityOfficeRequestCalendarHandler(() => reloaded),
        });
        const pending = readOfficeRequest(reloaded.getGeneralById(generalId)?.meta)!;
        expect(pending.status).toBe('pending');
        hooks = await createDatabaseTurnHooks(databaseUrl!, reloaded);
        const turnTime = reloaded.gameTickToDate(pending.dueTick);
        await reloaded.advanceMonth(turnTime);
        await hooks.hooks.flushChanges?.({
            lastTurnTime: turnTime.toISOString(),
            processedGenerals: 0,
            processedTurns: 0,
            durationMs: 0,
            partial: false,
        });
        const saved = await db.general.findUniqueOrThrow({ where: { id: generalId } });
        expect(saved.officerLevel).toBe(4);
        expect(readOfficeRequest(saved.meta)?.status).toBe('approved');
        expect((await db.city.findUniqueOrThrow({ where: { id: worldId } })).meta).toMatchObject({ officer_set: 16 });
        const count = await db.logEntry.count({ where: { generalId } });
        await hooks.hooks.flushChanges?.({
            lastTurnTime: turnTime.toISOString(),
            processedGenerals: 0,
            processedTurns: 0,
            durationMs: 0,
            partial: false,
        });
        expect(await db.logEntry.count({ where: { generalId } })).toBe(count);
    });
});
