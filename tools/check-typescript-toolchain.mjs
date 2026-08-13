import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedApiVersion = '6.0.3';
const expectedCliVersion = '7.0.2';

const consumers = [
    ['root', 'package.json'],
    ['game frontend', 'app/game-frontend/package.json'],
    ['gateway frontend', 'app/gateway-frontend/package.json'],
];

for (const [label, packagePath] of consumers) {
    const requireFromConsumer = createRequire(path.join(workspaceRoot, packagePath));
    const version = requireFromConsumer('typescript').version;
    if (version !== expectedApiVersion) {
        throw new Error(`${label} resolved TypeScript API ${version}; expected ${expectedApiVersion}`);
    }
}

const nativeTscPath = path.join(workspaceRoot, 'node_modules/@typescript/native/bin/tsc');
const nativeResult = spawnSync(process.execPath, [nativeTscPath, '--version'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
});
if (nativeResult.status !== 0) {
    throw new Error(nativeResult.stderr || nativeResult.stdout || 'TypeScript 7 tsc failed');
}

const cliVersion = nativeResult.stdout.trim().replace(/^Version\s+/, '');
if (cliVersion !== expectedCliVersion) {
    throw new Error(`native tsc resolved ${cliVersion}; expected ${expectedCliVersion}`);
}

console.log(`TypeScript API ${expectedApiVersion}; native tsc ${expectedCliVersion}`);
