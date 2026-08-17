import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

const sourceRoot = path.resolve(import.meta.dirname, '../src');
const fontFamilyDeclaration = /font-family\s*:\s*([^;]+);/g;
const fontShorthandDeclaration = /(?:^|[\s{])font\s*:\s*([^;]+);/gm;

const listStyleSources = async (): Promise<string[]> => {
    const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });

    return entries
        .filter((entry) => entry.isFile() && (entry.name.endsWith('.css') || entry.name.endsWith('.vue')))
        .map((entry) => path.join(entry.parentPath, entry.name))
        .sort();
};

void describe('game content font contract', () => {
    void it('loads Pretendard once from the global stylesheet entry', async () => {
        const importPattern =
            /@import url\(['"]https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard\/dist\/web\/static\/pretendard\.css['"]\);/g;
        const imports: string[] = [];

        for (const file of await listStyleSources()) {
            const source = await readFile(file, 'utf8');
            if (importPattern.test(source)) {
                imports.push(path.relative(sourceRoot, file));
            }
            importPattern.lastIndex = 0;
        }

        assert.deepEqual(imports, ['assets/main.css']);
    });

    void it('uses the shared sans token for every explicit content font declaration', async () => {
        const violations: string[] = [];

        for (const file of await listStyleSources()) {
            const source = await readFile(file, 'utf8');

            for (const match of source.matchAll(fontFamilyDeclaration)) {
                const value = match[1]?.trim();
                if (value !== 'inherit' && value !== 'var(--sammo-font-sans)') {
                    violations.push(`${path.relative(sourceRoot, file)}: font-family: ${value}`);
                }
            }

            for (const match of source.matchAll(fontShorthandDeclaration)) {
                const value = match[1]?.trim();
                if (value !== 'inherit' && !value?.includes('var(--sammo-font-sans)')) {
                    violations.push(`${path.relative(sourceRoot, file)}: font: ${value}`);
                }
            }
        }

        assert.deepEqual(violations, []);
    });
});
