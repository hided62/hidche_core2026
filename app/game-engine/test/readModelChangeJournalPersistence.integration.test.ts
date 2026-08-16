import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TurnDaemonCommandResult, TurnRunResult } from '@sammo-ts/common';
import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';
import { LogCategory, LogFormat, LogScope, type MapDefinition, type ScenarioConfig } from '@sammo-ts/logic';

import { createDatabaseTurnHooks, type DatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.READ_MODEL_JOURNAL_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const worldId = 991_816;
const directLogGeneralId = 991_817;
const requestId = 'integration:engine:read-model-journal:direct-logs';
const rollbackConstraint = 'read_model_outbox_engine_rollback_test';

const assertDedicatedDatabase = (rawUrl: string): void => {
    const schema = new URL(rawUrl).searchParams.get('schema');
    if (!schema?.endsWith('read_model_journal_integration')) {
        throw new Error(`Refusing to mutate non-dedicated schema: ${schema ?? '(missing)'}`);
    }
};

const scenarioConfig: ScenarioConfig = {
    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 65 },
    iconPath: '',
    map: {},
    const: { feature: 'stable' },
    environment: { mapName: 'che', unitSet: 'che' },
};

const map: MapDefinition = {
    id: 'read-model-journal-integration',
    name: 'read-model journal integration',
    cities: [],
};

const initialState: TurnWorldState = {
    id: worldId,
    currentYear: 190,
    currentMonth: 1,
    tickSeconds: 600,
    lastTurnTime: new Date('2026-08-16T00:00:00.000Z'),
    meta: {
        lastTurnTime: '2026-08-16T00:00:00.000Z',
        scenarioMeta: {
            title: 'read-model journal integration',
            startYear: 190,
            life: null,
            fiction: null,
            history: [],
            ignoreDefaultEvents: false,
        },
    },
};

const turnRunResult = (world: InMemoryTurnWorld): TurnRunResult => ({
    lastTurnTime: world.getState().lastTurnTime.toISOString(),
    processedGenerals: 0,
    processedTurns: 0,
    durationMs: 0,
    partial: false,
});

integration('game-engine read-model journal PostgreSQL transaction', () => {
    let db: GamePrismaClient;
    let disconnect: (() => Promise<void>) | undefined;
    let hooks: DatabaseTurnHooks | undefined;

    beforeAll(async () => {
        if (!databaseUrl) {
            throw new Error('READ_MODEL_JOURNAL_DATABASE_URL is required.');
        }
        assertDedicatedDatabase(databaseUrl);
        const connector = createGamePostgresConnector({ url: databaseUrl });
        db = connector.prisma;
        disconnect = connector.disconnect;
        await connector.connect();

        await db.$executeRawUnsafe(`ALTER TABLE read_model_outbox DROP CONSTRAINT IF EXISTS ${rollbackConstraint}`);
        await db.inputEvent.deleteMany({ where: { requestId } });
        await db.logEntry.deleteMany({ where: { text: { startsWith: '[read-model-journal]' } } });
        await db.worldState.deleteMany({ where: { id: worldId } });
        await db.$executeRaw`TRUNCATE TABLE "read_model_outbox", "read_model_revision" RESTART IDENTITY`;
        await db.worldState.create({
            data: {
                id: worldId,
                scenarioCode: 'read-model-journal-integration',
                currentYear: initialState.currentYear,
                currentMonth: initialState.currentMonth,
                tickSeconds: initialState.tickSeconds,
                config: JSON.parse(JSON.stringify(scenarioConfig)) as GamePrisma.InputJsonValue,
                meta: initialState.meta as GamePrisma.InputJsonValue,
            },
        });
    });

    afterAll(async () => {
        await hooks?.close();
        if (db) {
            await db.$executeRawUnsafe(
                `ALTER TABLE read_model_outbox DROP CONSTRAINT IF EXISTS ${rollbackConstraint}`
            );
            await db.inputEvent.deleteMany({ where: { requestId } });
            await db.logEntry.deleteMany({ where: { text: { startsWith: '[read-model-journal]' } } });
            await db.worldState.deleteMany({ where: { id: worldId } });
            await db.$executeRaw`TRUNCATE TABLE "read_model_outbox", "read_model_revision" RESTART IDENTITY`;
        }
        await disconnect?.();
    });

    it('commits visible state/log domains atomically and excludes clock-only or rolled-back work', async () => {
        const snapshot: TurnWorldSnapshot = {
            generals: [],
            cities: [],
            nations: [],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            scenarioConfig,
            scenarioMeta: initialState.meta.scenarioMeta as TurnWorldSnapshot['scenarioMeta'],
            map,
        };
        const world = new InMemoryTurnWorld(initialState, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        hooks = await createDatabaseTurnHooks(databaseUrl!, world);

        world.setLastTurnTime(new Date('2026-08-16T00:10:00.000Z'));
        await hooks.hooks.flushChanges?.(turnRunResult(world));
        expect(hooks.takeCommittedReadModelChangeReceipt()).toBeNull();
        await hooks.hooks.flushChanges?.(turnRunResult(world));
        expect(hooks.takeCommittedReadModelChangeReceipt()).toBeNull();
        await expect(db.readModelRevision.count()).resolves.toBe(0);
        await expect(db.readModelOutbox.count()).resolves.toBe(0);

        await db.$executeRawUnsafe(`
            ALTER TABLE read_model_outbox
            ADD CONSTRAINT ${rollbackConstraint}
            CHECK ((payload->>'version')::integer <> 1)
        `);
        world.updateWorldMeta({ durableFixture: 'must-rollback' });
        world.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.SUMMARY,
            format: LogFormat.RAWTEXT,
            text: '[read-model-journal] rollback',
        });
        await expect(hooks.hooks.flushChanges?.(turnRunResult(world))).rejects.toThrow(rollbackConstraint);
        expect(hooks.takeCommittedReadModelChangeReceipt()).toBeNull();
        await expect(db.logEntry.count({ where: { text: '[read-model-journal] rollback' } })).resolves.toBe(0);
        await expect(db.readModelRevision.count()).resolves.toBe(0);
        await expect(db.readModelOutbox.count()).resolves.toBe(0);
        expect((await db.worldState.findUniqueOrThrow({ where: { id: worldId } })).meta).not.toMatchObject({
            durableFixture: 'must-rollback',
        });

        await db.$executeRawUnsafe(`ALTER TABLE read_model_outbox DROP CONSTRAINT ${rollbackConstraint}`);
        await hooks.hooks.flushChanges?.(turnRunResult(world));
        const stateAndLogReceipt = hooks.takeCommittedReadModelChangeReceipt();
        expect(stateAndLogReceipt?.changes).toMatchObject({
            worldChanged: true,
            globalRecordsChanged: true,
        });
        expect(stateAndLogReceipt?.invalidation.revisions).toEqual([
            { domain: 'map.world', entityId: 0, revision: 1n },
            { domain: 'records.global', entityId: 0, revision: 1n },
            { domain: 'world.content', entityId: 0, revision: 1n },
        ]);
        await expect(db.logEntry.count({ where: { text: '[read-model-journal] rollback' } })).resolves.toBe(1);
        await expect(db.readModelOutbox.count()).resolves.toBe(1);

        await world.advanceMonth(new Date('2026-08-16T00:20:00.000Z'));
        await hooks.hooks.flushChanges?.(turnRunResult(world));
        const monthReceipt = hooks.takeCommittedReadModelChangeReceipt();
        expect(monthReceipt?.changes.worldChanged).toBe(true);
        expect(monthReceipt?.invalidation.revisions).toEqual([
            { domain: 'map.world', entityId: 0, revision: 2n },
            { domain: 'world.content', entityId: 0, revision: 2n },
        ]);
        await expect(db.worldState.findUniqueOrThrow({ where: { id: worldId } })).resolves.toMatchObject({
            currentYear: 190,
            currentMonth: 2,
        });

        await db.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'shiftSchedule',
                status: 'PROCESSING',
                payload: {},
            },
        });
        const directResult: TurnDaemonCommandResult = {
            type: 'shiftSchedule',
            ok: true,
            actionId: 'read-model-journal-direct-log',
            deltaMinutes: 0,
            lastTurnTime: world.getState().lastTurnTime.toISOString(),
            shiftedGenerals: 0,
            shiftedAuctions: 0,
        };
        await hooks.hooks.executeCommand?.(requestId, async ({ db: transaction }) => {
            if (!transaction) {
                throw new Error('Expected the direct-log command transaction.');
            }
            await transaction.logEntry.createMany({
                data: [
                    {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        year: 190,
                        month: 2,
                        text: '[read-model-journal] direct general',
                        generalId: directLogGeneralId,
                    },
                    {
                        scope: LogScope.SYSTEM,
                        category: LogCategory.SUMMARY,
                        year: 190,
                        month: 2,
                        text: '[read-model-journal] direct global',
                    },
                    {
                        scope: LogScope.SYSTEM,
                        category: LogCategory.HISTORY,
                        year: 190,
                        month: 2,
                        text: '[read-model-journal] direct history',
                    },
                ],
            });
            return directResult;
        });
        const directLogReceipt = hooks.takeCommittedReadModelChangeReceipt();
        expect(directLogReceipt?.changes).toMatchObject({
            recordGeneralIds: [directLogGeneralId],
            globalRecordsChanged: true,
            worldHistoryChanged: true,
            worldChanged: false,
        });
        expect(directLogReceipt?.invalidation.revisions).toEqual([
            { domain: 'records.general', entityId: directLogGeneralId, revision: 1n },
            { domain: 'records.global', entityId: 0, revision: 2n },
            { domain: 'records.history', entityId: 0, revision: 1n },
        ]);
        await expect(db.readModelOutbox.count()).resolves.toBe(3);
        await expect(db.logEntry.count({ where: { text: { startsWith: '[read-model-journal] direct' } } })).resolves.toBe(
            3
        );

        world.updateWorldMeta({ queueProbe: 1 });
        await hooks.hooks.flushChanges?.(turnRunResult(world));
        world.updateWorldMeta({ queueProbe: 2 });
        await hooks.hooks.flushChanges?.(turnRunResult(world));
        const firstQueuedReceipt = hooks.takeCommittedReadModelChangeReceipt();
        const secondQueuedReceipt = hooks.takeCommittedReadModelChangeReceipt();
        expect(firstQueuedReceipt?.outboxId).toBeLessThan(secondQueuedReceipt?.outboxId ?? 0n);
        expect(firstQueuedReceipt?.changes.worldChanged).toBe(true);
        expect(secondQueuedReceipt?.changes.worldChanged).toBe(true);
        expect(hooks.takeCommittedReadModelChangeReceipt()).toBeNull();
        await expect(db.readModelOutbox.count()).resolves.toBe(5);
    });
});
