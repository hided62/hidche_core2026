import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const collectVueFiles = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map((entry) => {
            const path = join(directory, entry.name);
            return entry.isDirectory() ? collectVueFiles(path) : entry.name.endsWith('.vue') ? [path] : [];
        })
    );
    return nested.flat();
};

describe('gateway profile display boundary', () => {
    it('keeps immutable raw profile names out of ordinary Vue copy', async () => {
        const files = await collectVueFiles(new URL('../src', import.meta.url).pathname);
        const forbidden = [
            { pattern: /\{\{\s*(?:profile|policy|operation)\.profileName\s*\}\}/, reason: 'direct interpolation' },
            { pattern: /서버 ID:/, reason: 'raw server ID label' },
            { pattern: /che:default/, reason: 'raw default profile example' },
            { pattern: /profile:scenario/, reason: 'raw profile placeholder' },
            {
                pattern: /currentScenario\s*\?\?\s*profile\.profileName/,
                reason: 'raw notification fallback',
            },
        ];

        for (const file of files) {
            const source = await readFile(file, 'utf8');
            for (const contract of forbidden) {
                assert.doesNotMatch(source, contract.pattern, `${file}: ${contract.reason}`);
            }
        }
    });
});
