import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitestPath = path.join(packageRoot, 'node_modules', 'vitest', 'vitest.mjs');
const defaultRuns = [
    { scenario: 'steady-state', pruneDeletedQueues: true },
    { scenario: 'growth', pruneDeletedQueues: true },
    { scenario: 'death-drain', pruneDeletedQueues: false },
    { scenario: 'death-drain', pruneDeletedQueues: true },
    { scenario: 'balanced-churn', pruneDeletedQueues: false },
    { scenario: 'balanced-churn', pruneDeletedQueues: true },
    { scenario: 'rollback-churn', pruneDeletedQueues: true },
];

const parseRuns = () => {
    const raw = process.env.NPC_LIFECYCLE_MEMORY_SCENARIOS;
    if (!raw) return defaultRuns;
    return raw.split(',').map((entry) => {
        const [scenario, variant = 'prune'] = entry.trim().split('@');
        if (!scenario) throw new Error(`invalid scenario entry: ${entry}`);
        if (variant !== 'prune' && variant !== 'retain') {
            throw new Error(`scenario variant must be prune or retain: ${entry}`);
        }
        return { scenario, pruneDeletedQueues: variant === 'prune' };
    });
};

const runChild = (run, reportPath, repetition) =>
    new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                '--expose-gc',
                vitestPath,
                'run',
                '--config',
                'vitest.config.ts',
                '--pool=threads',
                '--maxWorkers=1',
                'test/npcLifecycleMemoryProfile.test.ts',
            ],
            {
                cwd: packageRoot,
                env: {
                    ...process.env,
                    NPC_LIFECYCLE_MEMORY_PROFILE: '1',
                    NPC_LIFECYCLE_MEMORY_SCENARIO: run.scenario,
                    NPC_LIFECYCLE_MEMORY_PRUNE_DELETED: run.pruneDeletedQueues ? '1' : '0',
                    NPC_LIFECYCLE_MEMORY_CHILD_REPORT_PATH: reportPath,
                    NPC_LIFECYCLE_MEMORY_REPETITION: String(repetition),
                },
                stdio: 'inherit',
            }
        );
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`${run.scenario} terminated by ${signal}`));
            } else if (code !== 0) {
                reject(new Error(`${run.scenario} exited with code ${code}`));
            } else {
                resolve();
            }
        });
    });

const runs = parseRuns();
const repetitions = Number(process.env.NPC_LIFECYCLE_MEMORY_REPETITIONS ?? 1);
if (!Number.isSafeInteger(repetitions) || repetitions <= 0) {
    throw new Error('NPC_LIFECYCLE_MEMORY_REPETITIONS must be a positive integer.');
}
const reportPath = path.resolve(
    packageRoot,
    process.env.NPC_LIFECYCLE_MEMORY_REPORT_PATH ?? 'test-results/npc-lifecycle-memory.json'
);
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'sammo-npc-lifecycle-memory-'));
const reports = [];
try {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        for (const [index, run] of runs.entries()) {
            const childReportPath = path.join(
                temporaryDirectory,
                `${String(repetition).padStart(2, '0')}-${String(index).padStart(2, '0')}.json`
            );
            await runChild(run, childReportPath, repetition);
            reports.push({
                repetition,
                ...JSON.parse(readFileSync(childReportPath, 'utf8')),
            });
        }
    }
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(
        reportPath,
        `${JSON.stringify(
            {
                schemaVersion: 1,
                generatedAt: new Date().toISOString(),
                inputs: {
                    cycles: Number(process.env.NPC_LIFECYCLE_MEMORY_CYCLES ?? 80),
                    batchSize: Number(process.env.NPC_LIFECYCLE_MEMORY_BATCH_SIZE ?? 100),
                    sampleEvery: Number(process.env.NPC_LIFECYCLE_MEMORY_SAMPLE_EVERY ?? 5),
                    baseGenerals: Number(process.env.NPC_LIFECYCLE_MEMORY_BASE_GENERALS ?? 1_200),
                    repetitions,
                },
                reports,
            },
            null,
            2
        )}\n`,
        'utf8'
    );
    console.log(`[npc-lifecycle-memory] wrote ${reports.length} scenario reports to ${reportPath}`);
} finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
}
