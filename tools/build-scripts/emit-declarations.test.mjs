import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { emitDeclarations } from './emit-declarations.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '../..');

test('native declarations preserve relative imports, subpaths and maps, and fail on type errors', async () => {
    const temporaryRoot = path.join(workspaceRoot, '.turbo');
    await mkdir(temporaryRoot, { recursive: true });
    const fixture = await mkdtemp(path.join(temporaryRoot, 'declaration-test-'));
    const outDir = path.join(fixture, 'dist');
    try {
        await mkdir(path.join(fixture, 'src'));
        await writeFile(path.join(fixture, 'package.json'), JSON.stringify({ type: 'module' }));
        await writeFile(
            path.join(fixture, 'tsconfig.build.json'),
            JSON.stringify({
                extends: path.join(workspaceRoot, 'tsconfig.base.json'),
                compilerOptions: { rootDir: 'src', outDir: 'dist' },
                include: ['src'],
            })
        );
        await writeFile(
            path.join(fixture, 'src/model.ts'),
            'export class Model { private readonly id = 1; getId(): number { return this.id; } }\n'
        );
        await writeFile(path.join(fixture, 'src/index.ts'), "export { Model } from './model.js';\n");
        await emitDeclarations({ options: { cwd: fixture, outDir } });
        assert.match(await readFile(path.join(outDir, 'index.d.ts'), 'utf8'), /from ['"]\.\/model\.js['"]/u);
        assert.match(await readFile(path.join(outDir, 'model.d.ts'), 'utf8'), /getId\(\): number/u);
        const map = JSON.parse(await readFile(path.join(outDir, 'model.d.ts.map'), 'utf8'));
        assert.deepEqual(map.sources, ['../src/model.ts']);
        await assert.rejects(readFile(path.join(outDir, 'index.js')), { code: 'ENOENT' });

        await writeFile(
            path.join(fixture, 'package.json'),
            JSON.stringify({ type: 'module', exports: { './*': './dist/src/*' } })
        );
        await emitDeclarations({ options: { cwd: fixture, outDir } });
        assert.equal(await readFile(path.join(outDir, 'index.d.ts'), 'utf8'), "export * from './src/index.js';\n");
        const { Model } = await import(pathToFileURL(path.join(outDir, 'src/model.js')).href);
        assert.equal(new Model().getId(), 1);
        await readFile(path.join(outDir, 'src/model.d.ts.map'));
        await readFile(path.join(outDir, 'src/model.js.map'));
        await writeFile(
            path.join(fixture, 'consumer.ts'),
            "import { Model } from './dist/index.js';\n" +
                "import { Model as SubpathModel } from './dist/src/model.js';\n" +
                'export const same: Model = new SubpathModel();\n'
        );
        await writeFile(
            path.join(fixture, 'tsconfig.consumer.json'),
            JSON.stringify({ extends: path.join(workspaceRoot, 'tsconfig.base.json'), files: ['consumer.ts'] })
        );
        execFileSync(
            'pnpm',
            ['-w', 'tsc7', '-p', path.join(fixture, 'tsconfig.consumer.json'), '--noEmit', '--types', 'node'],
            {
                cwd: fixture,
                stdio: 'pipe',
            }
        );

        await writeFile(path.join(fixture, 'src/model.ts'), 'export const id: number = "invalid";\n');
        await assert.rejects(emitDeclarations({ options: { cwd: fixture, outDir } }), /Declaration emission failed/u);
    } finally {
        await rm(fixture, { recursive: true, force: true });
    }
});
