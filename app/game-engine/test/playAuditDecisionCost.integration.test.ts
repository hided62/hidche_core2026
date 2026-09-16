import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';
import { persistAuditDecisions } from '../src/playAudit/decisionPersistence.js';
import { buildAuditDecisionFixture } from './fixtures/playAuditDecision.js';

const databaseUrl = process.env.PLAY_AUDIT_COST_DATABASE_URL;
describe.skipIf(!databaseUrl)('decision storage cost probe', () => {
    let db: GamePrismaClient;
    let close: () => Promise<void>;
    let recording = false;
    let statements: Record<string, number> = {};
    beforeAll(async () => {
        if (new URL(databaseUrl!).searchParams.get('schema') !== 'play_audit_cost_decision_fixture')
            throw new Error('Dedicated audit cost fixture required');
        const connector = createGamePostgresConnector({
            url: databaseUrl!,
            maxConnections: 1,
            log: [{ emit: 'event', level: 'query' }],
        });
        await connector.connect();
        db = connector.prisma;
        // connector의 반환 타입은 log generic을 지운다. 위에서 활성화한 event만 구독한다.
        const observedDb = db as GamePrismaClient<GamePrisma.PrismaClientOptions, 'query'>;
        observedDb.$on('query', (event) => {
            if (!recording) return;
            // 원문 SQL/params는 보존하거나 출력하지 않고 명령 종류만 집계한다.
            const command = event.query.trim().split(/\s+/, 1)[0]!.toUpperCase();
            statements[command] = (statements[command] ?? 0) + 1;
        });
        close = () => connector.disconnect();
        await db.playAuditDecisionChunk.deleteMany();
        await db.playAuditDecision.deleteMany();
    });
    afterAll(async () => close?.());

    it('measures a batch boundary without truncating stored steps', async () => {
        const decisions = Array.from({ length: 201 }, (_, index) => {
            const decision = buildAuditDecisionFixture(`cost-${index}`, 'cost-current');
            return { ...decision, tick: decision.tick + index };
        });
        const payloadBytes = Buffer.byteLength(JSON.stringify(decisions));
        statements = {};
        recording = true;
        const start = performance.now();
        try {
            await db.$transaction((tx) => persistAuditDecisions(tx, decisions), { timeout: 30_000 });
        } finally {
            recording = false;
        }
        const writeMs = performance.now() - start;
        const writeStatements = { ...statements };
        // 200결정: header1 + chunk3, 나머지1결정: header1 + chunk1. hash 조회는 batch당1.
        expect(writeStatements.INSERT).toBe(6);
        expect(writeStatements.SELECT).toBe(2);
        expect(await db.playAuditDecision.count()).toBe(201);
        expect(await db.playAuditDecisionChunk.count()).toBe(603);
        const [storage] = await db.$queryRaw<
            { headers: bigint; steps: bigint; headerBytes: bigint; chunkBytes: bigint }[]
        >`
            SELECT
                (SELECT count(*) FROM play_audit_decision) AS headers,
                (SELECT sum(jsonb_array_length(steps)) FROM play_audit_decision_chunk) AS steps,
                (SELECT sum(pg_column_size(d)) FROM play_audit_decision d) AS "headerBytes",
                (SELECT sum(pg_column_size(c)) FROM play_audit_decision_chunk c) AS "chunkBytes"
        `;
        expect(Number(storage!.steps)).toBe(201 * 302);
        const relations = await db.$queryRaw<
            { name: string; tableBytes: bigint; indexBytes: bigint; totalBytes: bigint }[]
        >`
            SELECT relname AS name, pg_table_size(oid) AS "tableBytes",
                pg_indexes_size(oid) AS "indexBytes", pg_total_relation_size(oid) AS "totalBytes"
            FROM pg_class WHERE relnamespace = current_schema()::regnamespace
                AND relname IN ('play_audit_decision', 'play_audit_decision_chunk')
            ORDER BY relname
        `;
        expect(relations).toHaveLength(2);
        await db.$executeRawUnsafe('ANALYZE play_audit_decision');
        const timings: number[] = [];
        for (let sample = 0; sample < 31; sample += 1) {
            const queryStart = performance.now();
            const rows = await db.playAuditDecision.findMany({
                where: { serverId: 'cost-current', generalId: 990321, year: 190, month: 1 },
                orderBy: [{ tick: 'desc' }, { id: 'desc' }],
                take: 51,
                select: { id: true, tick: true, summary: true, stepCount: true },
            });
            if (sample > 0) timings.push(performance.now() - queryStart);
            expect(rows).toHaveLength(51);
            expect(rows[0]!.id).toBe('cost-200');
        }
        timings.sort((a, b) => a - b);
        const plan = await db.$queryRaw`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT id, tick, summary, step_count FROM play_audit_decision
            WHERE server_id = 'cost-current' AND general_id = 990321 AND year = 190 AND month = 1
            ORDER BY tick DESC, id DESC LIMIT 51
        `;
        const metrics = {
            scope: 'synthetic 201 decisions, 302 steps each; isolated schema, warm local reads',
            limitations: 'Not production p95; no gameplay baseline, WAL or retained heap measurement. SQL counts cover only the persistence transaction. Repetitive synthetic steps compress well. Relation allocation can retain space from previous runs.',
            decisions: 201,
            steps: Number(storage!.steps),
            chunks: 603,
            payloadBytes,
            headerRowBytes: Number(storage!.headerBytes),
            chunkRowBytes: Number(storage!.chunkBytes),
            relations: relations.map((row) => ({
                name: row.name,
                tableBytes: Number(row.tableBytes),
                indexBytes: Number(row.indexBytes),
                totalBytes: Number(row.totalBytes),
            })),
            writeMs,
            writeStatements,
            samples: timings.length,
            readP50Ms: timings[14],
            readP95Ms: timings[28],
            plan,
        };
        await writeFile('/tmp/play-audit-decision-cost.json', JSON.stringify(metrics, null, 2));
    }, 60_000);
});
