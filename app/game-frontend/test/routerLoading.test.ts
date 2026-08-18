import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

const routerSourcePath = path.resolve(import.meta.dirname, '../src/router/index.ts');
const mainDashboardSourcePath = path.resolve(import.meta.dirname, '../src/stores/mainDashboard.ts');

void describe('game route loading contract', () => {
    void it('loads view components through route-level dynamic imports', async () => {
        const source = await readFile(routerSourcePath, 'utf8');
        const staticViewImports = [...source.matchAll(/^import\s+.+\s+from\s+['"]\.\.\/views\//gm)];
        const lazyViewImports = [...source.matchAll(/=\s*\(\)\s*=>\s*import\(['"]\.\.\/views\//g)];
        const routedViewComponents = new Set(
            [...source.matchAll(/^\s*component:\s*([A-Z][A-Za-z0-9]+View),?$/gm)].map((match) => match[1])
        );

        assert.deepEqual(staticViewImports, []);
        assert.equal(lazyViewImports.length, routedViewComponents.size);
        assert.ok(lazyViewImports.length >= 35);
    });

    void it('does not preload the server-side logic barrel from the main dashboard', async () => {
        const source = await readFile(mainDashboardSourcePath, 'utf8');

        assert.doesNotMatch(source, /from\s+['"]@sammo-ts\/logic['"]/);
        assert.match(source, /from\s+['"]@sammo-ts\/logic\/messages\/message\.js['"]/);
    });
});
