import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import { persistAuditPolicies } from '../src/playAudit/policyPersistence.js';
import type { PendingAuditPolicy } from '../src/playAudit/policy.js';
const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const serverId = 'policy-persistence-fixture';
const requestId = 'policy-persistence-request';
integration('immutable policy persistence', () => {
    let db: GamePrismaClient;
    let close: () => Promise<void>;
    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
        await db.playAuditPolicy.deleteMany({ where: { serverId } });
        await db.inputEvent.deleteMany({ where: { requestId } });
    });
    afterAll(async () => {
        await db.playAuditPolicy.deleteMany({ where: { serverId } });
        await db.inputEvent.deleteMany({ where: { requestId } });
        await db.nation.deleteMany({ where: { id: 999915 } });
        await close();
    });
    it('rolls back policy and state together, binds durable sequence, and rejects conflicting replay', async () => {
        const input = await db.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'setNationSetting',
                actorUserId: 'audit-owner',
                status: 'PROCESSING',
            },
        });
        const context = { requestId, sequence: input.sequence, actorUserId: 'audit-owner' };
        const baseline: PendingAuditPolicy = {
            schemaVersion: 1,
            id: `${serverId}:1`,
            serverId,
            nationId: 999915,
            area: 'DEFENCE',
            revision: 1,
            previousId: null,
            source: 'BASELINE',
            year: 190,
            month: 1,
            tick: 1,
            requestId: null,
            ordinal: 1,
            actor: null,
            before: null,
            after: { scout: 0 },
        };
        const change: PendingAuditPolicy = {
            ...baseline,
            id: `${serverId}:2`,
            revision: 2,
            previousId: baseline.id,
            source: 'CHANGE',
            requestId,
            ordinal: 2,
            actor: {
                userId: 'audit-owner',
                generalId: 1,
                name: '기록 군주',
                nationId: 999915,
                officerLevel: 12,
                npcState: 0,
                permission: 4,
            },
            before: { scout: 0 },
            after: { scout: 1 },
        };
        await expect(
            db.$transaction(async (tx) => {
                await tx.nation.create({ data: { id: 999915, name: '정책국', color: '#ffffff', meta: { scout: 1 } } });
                await persistAuditPolicies(tx, [baseline, change], context);
                await tx.inputEvent.update({ where: { requestId }, data: { status: 'SUCCEEDED' } });
                throw new Error('policy rollback');
            })
        ).rejects.toThrow('policy rollback');
        expect(await db.playAuditPolicy.count({ where: { serverId } })).toBe(0);
        expect(await db.nation.findUnique({ where: { id: 999915 } })).toBeNull();
        expect((await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).status).toBe('PROCESSING');
        await db.$transaction(async (tx) => {
            await tx.nation.create({ data: { id: 999915, name: '정책국', color: '#ffffff', meta: { scout: 1 } } });
            await persistAuditPolicies(tx, [baseline, change], context);
            await tx.inputEvent.update({ where: { requestId }, data: { status: 'SUCCEEDED' } });
        });
        await db.$transaction((tx) => persistAuditPolicies(tx, [baseline, change], context));
        const rows = await db.playAuditPolicy.findMany({ where: { serverId }, orderBy: { revision: 'asc' } });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ inputSequence: null, actor: null });
        expect(rows[1]).toMatchObject({
            inputSequence: input.sequence,
            requestId,
            before: { scout: 0 },
            after: { scout: 1 },
        });
        await expect(
            db.$transaction((tx) => persistAuditPolicies(tx, [{ ...change, after: { scout: 0 } }], context))
        ).rejects.toThrow('replay payload conflict');
        await expect(
            db.$transaction((tx) => persistAuditPolicies(tx, [change], { ...context, actorUserId: 'other' }))
        ).rejects.toThrow('actor/request mismatch');
        await expect(db.$transaction((tx) => persistAuditPolicies(tx, [change]))).rejects.toThrow(
            'input event context missing'
        );
        expect((await db.playAuditPolicy.findUniqueOrThrow({ where: { id: change.id } })).after).toEqual({ scout: 1 });
    });
});
