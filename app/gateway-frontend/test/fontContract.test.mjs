import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

const sourceRoot = path.resolve(import.meta.dirname, '../src');
const fontFamilyDeclaration = /font-family\s*:\s*([^;]+);/g;
const fontShorthandDeclaration = /(?:^|[\s{])font\s*:\s*([^;]+);/gm;
const forcedSerifFamily = /Times New Roman|(?<![\w-])serif(?![\w-])/i;

const listStyleSources = async () => {
    const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });

    return entries
        .filter((entry) => entry.isFile() && (entry.name.endsWith('.css') || entry.name.endsWith('.vue')))
        .map((entry) => path.join(entry.parentPath, entry.name))
        .sort();
};

describe('gateway content font contract', () => {
    it('does not force Times New Roman or a generic serif family', async () => {
        const violations = [];

        for (const file of await listStyleSources()) {
            const source = await readFile(file, 'utf8');
            for (const match of source.matchAll(fontFamilyDeclaration)) {
                const value = match[1]?.trim() ?? '';
                if (forcedSerifFamily.test(value)) {
                    violations.push(`${path.relative(sourceRoot, file)}: font-family: ${value}`);
                }
            }

            for (const match of source.matchAll(fontShorthandDeclaration)) {
                const value = match[1]?.trim() ?? '';
                if (forcedSerifFamily.test(value)) {
                    violations.push(`${path.relative(sourceRoot, file)}: font: ${value}`);
                }
            }
        }

        assert.deepEqual(violations, []);
    });
});
