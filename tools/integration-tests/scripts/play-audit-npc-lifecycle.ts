/** Dedicated real-DB scenario run. No fabricated decisions or direct city ownership edits. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { asRecord, type TurnCheckpoint } from '@sammo-ts/common';
import { createGamePostgresConnector } from '@sammo-ts/infra';
import { createTurnDaemonRuntime, seedScenarioToDatabase } from '@sammo-ts/game-engine';

const databaseUrl = process.env.DATABASE_URL;
assert(
    databaseUrl && new URL(databaseUrl).searchParams.get('schema')?.endsWith('_npc_audit_lifecycle'),
    'Dedicated _npc_audit_lifecycle schema required'
);
const output = resolve(process.env.NPC_AUDIT_OUTPUT ?? 'test-results/npc-audit-lifecycle');
await mkdir(output, { recursive: true });
const connector = createGamePostgresConnector({ url: databaseUrl });
await connector.connect();
const db = connector.prisma;
const verify = async (progress: unknown[]) => {
    const state = await db.worldState.findFirstOrThrow();
    assert.equal(asRecord(state.meta).serverId, 'npc-audit-lifecycle-2601');
    assert(state.currentYear >= 183);
    assert.equal(asRecord(state.meta).playAuditGap, undefined, 'Audit dropped a batch');
    assert.equal(
        await db.city.count({ where: { nationId: 0, level: { gt: 0 } } }),
        0,
        'Empty-land conquest incomplete'
    );
    const subjects = [];
    // 실제 임명된 수뇌만 국가 AI를 실행한다. 모든 NPC 종류에 수뇌직을 강제로 부여하지 않는다.
    for (const selection of [
        { npcState: 2, phase: 'general' },
        { npcState: 3, phase: 'general' },
        { npcState: { in: [2, 3] }, phase: 'nation' },
    ]) {
        const row = await db.playAuditDecision.findFirst({
            where: { ...selection, year: { gte: 183 } },
            orderBy: [{ year: 'desc' }, { month: 'desc' }, { tick: 'desc' }],
            include: { chunks: { orderBy: { ordinal: 'asc' } } },
        });
        assert(row && row.chunks.length, `Missing actual NPC ${JSON.stringify(selection)} decision`);
        const steps = row.chunks.flatMap((chunk) => (Array.isArray(chunk.steps) ? chunk.steps : []));
        assert.equal(steps.length, row.stepCount);
        assert.equal(asRecord(steps[0]).kind, 'DECISION_START');
        assert(steps.some((step) => asRecord(step).kind === 'DECISION_END'));
        assert.equal(asRecord(steps.at(-1)).kind, 'EXECUTION_ATTEMPT');
        subjects.push({
            generalId: row.generalId,
            npcState: row.npcState,
            phase: row.phase,
            year: row.year,
            month: row.month,
            id: row.id,
            steps: row.stepCount,
        });
    }
    const evidence = {
        scenario: 2601,
        serverId: 'npc-audit-lifecycle-2601',
        year: state.currentYear,
        month: state.currentMonth,
        decisions: await db.playAuditDecision.count(),
        progress,
        subjects,
    };
    await writeFile(resolve(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ success: true, ...evidence, progress: undefined }));
};
if (process.argv.includes('--verify')) {
    try {
        const progress = JSON.parse(
            await readFile(resolve(output, 'progress.json'), 'utf8').catch(() => '[]')
        ) as unknown[];
        await verify(progress);
    } finally {
        await connector.disconnect();
    }
} else {
    assert.equal(await db.worldState.count(), 0, 'Use a fresh migrated schema; existing seasons must be preserved');
    process.env.INTEGRATION_WORLD_SEED = 'npc-audit-lifecycle-2601-v1';
    await seedScenarioToDatabase({
        scenarioId: 2601,
        databaseUrl,
        gameClockMode: 'manual',
        now: new Date('2026-09-26T00:00:00Z'),
        installOptions: {
            turnTermMinutes: 5,
            sync: false,
            npcMode: 2,
            serverId: 'npc-audit-lifecycle-2601',
            tournamentTrig: false,
        },
    });
    const runtime = await createTurnDaemonRuntime({
        profile: 'che:default',
        databaseUrl,
        gameClockMode: 'manual',
        enableLeaseHeartbeat: true,
        leaseDurationMs: 300_000,
        exclusiveFastForward: true,
        databaseTransactionTimeoutMs: 60_000,
    });
    const progress = [];
    try {
        for (let iteration = 0; iteration < 120; iteration++) {
            const before = runtime.world.getState();
            const target = new Date(before.lastTurnTime.getTime() + before.tickSeconds * 1000);
            runtime.world.advanceGameClockTo(target, new Date());
            let checkpoint: TurnCheckpoint | undefined;
            do {
                const result = await runtime.processor.run(
                    target,
                    { budgetMs: 1000, maxGenerals: 20, catchUpCap: 1 },
                    checkpoint
                );
                await runtime.hooks?.flushChanges?.(result);
                checkpoint = result.checkpoint;
                assert(!result.partial || result.processedGenerals > 0 || result.processedTurns > 0, 'No progress');
            } while (checkpoint);
            const state = runtime.world.getState();
            const neutral = runtime.world.listCities().filter((city) => city.nationId === 0 && city.level > 0).length;
            const row = {
                year: state.currentYear,
                month: state.currentMonth,
                neutral,
                generals: runtime.world.listGenerals().length,
                decisions: await db.playAuditDecision.count(),
            };
            progress.push(row);
            await writeFile(resolve(output, 'progress.json'), JSON.stringify(progress, null, 2));
            if (iteration % 6 === 0 || state.currentYear >= 183) console.log(JSON.stringify(row));
            assert.equal(
                asRecord((await db.worldState.findFirstOrThrow()).meta).playAuditGap,
                undefined,
                'Audit dropped a batch'
            );
            if (state.currentYear >= 184 && neutral === 0) break;
        }
        await verify(progress);
    } finally {
        await runtime.close();
        await connector.disconnect();
    }
}
