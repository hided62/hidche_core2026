import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

// JS bundling stays in tsdown. Native TypeScript emits the complete declaration
// tree instead of repeatedly bundling large inferred Prisma/tRPC type graphs.
/**
 * @param {import('tsdown').BuildContext} context
 * @returns {Promise<void>}
 */
export const emitDeclarations = async ({ options }) => {
    const manifest = JSON.parse(await readFile(path.join(options.cwd, 'package.json'), 'utf8'));
    // logic's existing wildcard export exposes dist/src/*. Keep one canonical
    // declaration tree so private class members retain their identity across
    // root and subpath imports, and keep the wildcard JS entry points working.
    const sourceExports = manifest.exports?.['./*'] === './dist/src/*';
    const args = [
        '-w',
        'tsc7',
        '-p',
        path.join(options.cwd, 'tsconfig.build.json'),
        ...(sourceExports ? [] : ['--emitDeclarationOnly']),
        '--types',
        'node',
        '--outDir',
        sourceExports ? path.join(options.outDir, 'src') : options.outDir,
    ];
    await new Promise((resolve, reject) => {
        const child = spawn('pnpm', args, { cwd: options.cwd, stdio: 'inherit' });
        child.once('error', reject);
        child.once('close', (code, signal) => {
            if (code === 0) resolve(undefined);
            else reject(new Error(`Declaration emission failed (${signal ?? code ?? 'unknown'}): ${options.cwd}`));
        });
    });
    if (sourceExports) {
        await writeFile(path.join(options.outDir, 'index.d.ts'), "export * from './src/index.js';\n");
    }
};
