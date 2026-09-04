import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(packageRoot, 'test-lanes.tsv');
const testRoot = path.join(packageRoot, 'test');
const supportedLanes = new Set(['core', 'reference', 'lifecycle', 'conditional']);
const supportedCommands = new Set(['core', 'reference', 'lifecycle', 'check']);

const usage = () => {
    process.stderr.write('usage: node run-test-lane.mjs <core|reference|lifecycle> [vitest arguments...]\n');
    process.exit(64);
};

const [lane, ...rawVitestArguments] = process.argv.slice(2);
const vitestArguments = rawVitestArguments[0] === '--' ? rawVitestArguments.slice(1) : rawVitestArguments;
if (!lane || !supportedCommands.has(lane)) {
    usage();
}

const rows = fs
    .readFileSync(registryPath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line, index) => {
        const fields = line.split('\t');
        if (fields.length !== 2) {
            throw new Error(`test-lanes.tsv row ${index + 1} must have exactly two tab-separated fields`);
        }
        const [file, registeredLane] = fields;
        if (!file || !registeredLane || !supportedLanes.has(registeredLane)) {
            throw new Error(`test-lanes.tsv row ${index + 1} is invalid`);
        }
        return { file, lane: registeredLane };
    });

const duplicateFiles = rows.map(({ file }) => file).filter((file, index, files) => files.indexOf(file) !== index);
if (duplicateFiles.length > 0) {
    throw new Error(`duplicate integration test lane entries: ${[...new Set(duplicateFiles)].join(', ')}`);
}

const discoveredFiles = fs
    .readdirSync(testRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
    .map((entry) => `test/${entry.name}`)
    .sort();
const registeredFiles = rows.map(({ file }) => file).sort();
if (JSON.stringify(discoveredFiles) !== JSON.stringify(registeredFiles)) {
    const registered = new Set(registeredFiles);
    const discovered = new Set(discoveredFiles);
    const missing = discoveredFiles.filter((file) => !registered.has(file));
    const stale = registeredFiles.filter((file) => !discovered.has(file));
    throw new Error(
        `integration test lane registry mismatch; missing=[${missing.join(', ')}] stale=[${stale.join(', ')}]`
    );
}

if (lane === 'check') {
    process.stdout.write(`integration test lane registry is valid (${registeredFiles.length} files)\n`);
    process.exit(0);
}

if (lane === 'lifecycle' && process.env.INTEGRATION_LIFECYCLE_DISPOSABLE !== '1') {
    throw new Error(
        'lifecycle tests truncate public/che schemas and Redis; set INTEGRATION_LIFECYCLE_DISPOSABLE=1 only for a dedicated stack'
    );
}

const files = rows.filter((row) => row.lane === lane).map(({ file }) => file);
const environment = {
    ...process.env,
    ...(lane === 'reference' ? { TURN_DIFFERENTIAL_REFERENCE: '1' } : {}),
};
const result = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'vitest.config.ts', ...files, ...vitestArguments],
    {
        cwd: packageRoot,
        env: environment,
        stdio: 'inherit',
    }
);
if (result.error) {
    throw result.error;
}
process.exit(result.status ?? 1);
