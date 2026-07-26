import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pm2Candidates = [
    '/home/letrhee/.nvm/versions/node/v22.15.1/bin/pm2',
    '/home/letrhee/.nvm/versions/node/v24.13.0/bin/pm2',
];

let processes;
for (const candidate of pm2Candidates) {
    try {
        const output = execFileSync(candidate, ['jlist'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        processes = JSON.parse(output.slice(output.indexOf('[')));
        break;
    } catch {
        // Try the next locally installed PM2 client.
    }
}
if (!processes) {
    throw new Error('Unable to read the local PM2 process list.');
}

const source = processes.find((process) => process.name === 'sammo-verify-che-api')?.pm2_env;
if (!source) {
    throw new Error('sammo-verify-che-api is required as the live environment source.');
}

const allowed = /^(DATABASE_URL|POSTGRES_|REDIS_|GAME_|GATEWAY_|PROFILE$|SCENARIO$)/;
const liveEnvironment = Object.fromEntries(
    Object.entries(source).filter(([key, value]) => allowed.test(key) && typeof value === 'string')
);
const result = spawnSync(
    'pnpm',
    [
        'exec',
        'playwright',
        'test',
        'main-records.spec.ts',
        '--config',
        'tools/frontend-legacy-parity/main-records.playwright.config.mjs',
    ],
    {
        cwd: repositoryRoot,
        env: { ...process.env, ...liveEnvironment },
        stdio: 'inherit',
    }
);
process.exitCode = result.status ?? 1;
