import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadConfigFromFile } from 'vite';

void describe('gateway frontend Vite config', () => {
    void it('keeps production source maps enabled', async () => {
        const configPath = path.resolve(import.meta.dirname, '../vite.config.ts');
        const loaded = await loadConfigFromFile(
            { command: 'build', mode: 'production' },
            configPath,
            path.dirname(configPath),
            undefined,
            undefined,
            'runner'
        );

        assert.equal(loaded?.config.build?.sourcemap, true);
    });
});
