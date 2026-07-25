import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveWorkspaceRoot } from '../src/orchestrator/workspaceRoot.js';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sammo-workspace-root-'));
    tempDirs.push(dir);
    return dir;
};

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('resolveWorkspaceRoot', () => {
    it('prefers the pnpm workspace above a nested package', () => {
        const root = makeTempDir();
        const packageDir = path.join(root, 'app', 'gateway-api');
        const sourceDir = path.join(packageDir, 'dist');
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
        fs.writeFileSync(path.join(packageDir, 'package.json'), '{}\n');

        expect(resolveWorkspaceRoot(sourceDir)).toBe(root);
    });

    it('falls back to the nearest package when there is no workspace marker', () => {
        const root = makeTempDir();
        const sourceDir = path.join(root, 'src', 'nested');
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.writeFileSync(path.join(root, 'package.json'), '{}\n');

        expect(resolveWorkspaceRoot(sourceDir)).toBe(root);
    });
});
