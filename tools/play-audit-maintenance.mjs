#!/usr/bin/env node
// stopped/reserved profile도 같은 fenced batch로 정리한다. 기본은 관찰만 하며 외부 scheduler가 실행한다.
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import { createGamePostgresConnector, pruneDeliveredReadModelOutbox } from '../packages/infra/dist/index.js';
import { prunePreviousAuditBatch } from '../app/game-engine/dist/index.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const schemas =
    args
        .find((arg) => arg.startsWith('--schemas='))
        ?.slice(10)
        .split(',') ?? [];
const budgetMs = Number(args.find((arg) => arg.startsWith('--budget-ms='))?.slice(12) ?? 3000);
if (
    !schemas.length ||
    schemas.some((schema) => !/^[a-z][a-z0-9_]{0,62}$/.test(schema)) ||
    !Number.isSafeInteger(budgetMs) ||
    budgetMs < 1 ||
    budgetMs > 60000 ||
    args.some((arg) => arg !== '--apply' && !arg.startsWith('--schemas=') && !arg.startsWith('--budget-ms='))
) {
    throw new Error('Usage: --schemas=che,kwe,... [--budget-ms=3000] [--apply]');
}
let failed = false;
for (const schema of schemas) {
    const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : new URL('postgresql://localhost');
    if (!process.env.DATABASE_URL) {
        url.hostname = process.env.POSTGRES_HOST ?? 'localhost';
        url.port = process.env.POSTGRES_PORT ?? '5432';
        url.username = process.env.POSTGRES_USER ?? 'sammo';
        url.password = process.env.POSTGRES_PASSWORD ?? '';
        url.pathname = `/${process.env.POSTGRES_DB ?? 'sammo'}`;
    }
    url.searchParams.set('schema', schema);
    const connector = createGamePostgresConnector({ url: url.href, maxConnections: 1 });
    try {
        await connector.connect();
        const db = connector.prisma;
        const world = await db.worldState.findFirst({ select: { meta: true } });
        const serverId =
            world?.meta && typeof world.meta === 'object' && !Array.isArray(world.meta) ? world.meta.serverId : null;
        if (typeof serverId !== 'string' || !serverId.trim()) {
            console.log(JSON.stringify({ schema, status: 'identityMissing', deleted: 0 }));
            continue;
        }
        if (!apply) {
            console.log(JSON.stringify({ schema, status: 'dryRun', apply: false }));
            continue;
        }
        const deadline = performance.now() + budgetMs;
        let auditDeleted = 0;
        let outboxDeleted = 0;
        let status = 'progress';
        let auditComplete = false;
        let outboxComplete = false;
        do {
            if (!auditComplete) {
                const result = await prunePreviousAuditBatch(db, serverId);
                auditDeleted += result.deleted;
                status = result.status;
                auditComplete = result.status === 'complete';
                if (result.status === 'identityChanged' || result.status === 'busy') break;
            }
            if (!outboxComplete) {
                outboxDeleted += await db.$transaction(async (tx) => {
                    await tx.$executeRaw`SET LOCAL statement_timeout='2000ms'`;
                    await tx.$executeRaw`SET LOCAL lock_timeout='250ms'`;
                    const deleted = await pruneDeliveredReadModelOutbox(tx, {
                        deliveredBefore: new Date(Date.now() - 86400000),
                        limit: 500,
                    });
                    outboxComplete = deleted < 500;
                    return deleted;
                });
            }
            if (auditComplete && outboxComplete) break;
            await setTimeout(25);
        } while (performance.now() < deadline);
        console.log(
            JSON.stringify({ schema, status, auditDeleted, outboxDeleted, complete: auditComplete && outboxComplete })
        );
    } catch {
        // 연결 URL과 원문 SQL을 출력하지 않고 scheduler가 감지할 수 있는 종료 코드를 남긴다.
        failed = true;
        console.error(JSON.stringify({ schema, status: 'failed' }));
    } finally {
        await connector.disconnect();
    }
}
if (failed) process.exitCode = 1;
