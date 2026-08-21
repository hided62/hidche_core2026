import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

const routerSourcePath = path.resolve(import.meta.dirname, '../src/router/index.ts');

void describe('gateway route loading contract', () => {
    void it('loads view components through route-level dynamic imports', async () => {
        const source = await readFile(routerSourcePath, 'utf8');
        const staticViewImports = [...source.matchAll(/^import\s+.+\s+from\s+['"]\.\.\/views\//gm)];
        const lazyViewComponents = new Set(
            [...source.matchAll(/^const\s+([A-Z][A-Za-z0-9]+View)\s*=\s*\(\)\s*=>\s*import\(['"]\.\.\/views\//gm)].map(
                (match) => match[1]
            )
        );
        const routedViewComponents = new Set(
            [...source.matchAll(/^\s*component:\s*([A-Z][A-Za-z0-9]+View),?$/gm)].map((match) => match[1])
        );

        assert.deepEqual(staticViewImports, []);
        assert.deepEqual(lazyViewComponents, routedViewComponents);
        assert.ok(lazyViewComponents.size >= 8);
    });
});
