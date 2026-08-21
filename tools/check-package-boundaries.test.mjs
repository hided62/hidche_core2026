import assert from 'node:assert/strict';
import test from 'node:test';

import { checkSource, extractImports } from './check-package-boundaries.mjs';

test('extracts multiline and type-only package imports', () => {
    assert.deepEqual(extractImports("import type { AppRouter } from '@sammo-ts/game-api';"), [
        { specifier: '@sammo-ts/game-api', typeOnly: true, clause: '{ AppRouter }' },
    ]);
    assert.equal(
        extractImports("import {\n  GamePrisma,\n  type DatabaseClient\n} from '@sammo-ts/infra';")[0]?.specifier,
        '@sammo-ts/infra'
    );
    assert.equal(
        extractImports("import { type AppRouter, type Profile } from '@sammo-ts/gateway-api';")[0]?.typeOnly,
        true
    );
});

test('rejects infrastructure access and process diagnostics in logic', () => {
    const zone = { name: 'logic', allowed: ['@sammo-ts/common'] };
    const violations = checkSource({
        source: "import { PrismaClient } from '@prisma/client/runtime';\nprocess.stdout.write('trace');\nfetch('/x');",
        relativePath: 'packages/logic/src/example.ts',
        zone,
    });
    assert.equal(violations.length, 3);
});

test('requires frontend backend references to be type-only', () => {
    const zone = {
        name: 'game-frontend',
        allowed: ['@sammo-ts/game-api'],
        frontend: true,
    };
    const violations = checkSource({
        source: "import { appRouter } from '@sammo-ts/game-api';",
        relativePath: 'app/game-frontend/src/trpc.ts',
        zone,
    });
    assert.deepEqual(violations, [
        'app/game-frontend/src/trpc.ts: frontend may reference @sammo-ts/game-api only through import type',
    ]);
});

test('rejects prefixed and bare Node builtins in frontend source', () => {
    const violations = checkSource({
        source: "import path from 'path';\nimport fs from 'node:fs';",
        relativePath: 'app/game-frontend/src/example.ts',
        zone: { name: 'game-frontend', allowed: [], frontend: true },
    });

    assert.deepEqual(violations, [
        'app/game-frontend/src/example.ts: frontend production code may not import path',
        'app/game-frontend/src/example.ts: frontend production code may not import node:fs',
    ]);
});

test('requires frontend common and logic runtime imports to use leaf subpaths', () => {
    const zone = {
        name: 'game-frontend',
        allowed: ['@sammo-ts/common', '@sammo-ts/logic'],
        frontend: true,
    };
    const violations = checkSource({
        source: [
            "import { formatServerDateTime } from '@sammo-ts/common';",
            "import { MESSAGE_MAILBOX_PUBLIC } from '@sammo-ts/logic';",
            "import type { MessageType } from '@sammo-ts/logic';",
        ].join('\n'),
        relativePath: 'app/game-frontend/src/example.ts',
        zone,
    });

    assert.deepEqual(violations, [
        'app/game-frontend/src/example.ts: frontend runtime must import a leaf subpath from @sammo-ts/common',
        'app/game-frontend/src/example.ts: frontend runtime must import a leaf subpath from @sammo-ts/logic',
    ]);
});

test('allows the isolated battle simulator worker to load the logic runtime root', () => {
    const violations = checkSource({
        source: "const loadProcessor = () => import('@sammo-ts/logic');",
        relativePath: 'app/game-frontend/src/workers/battleSimulator.worker.ts',
        zone: { name: 'game-frontend', allowed: ['@sammo-ts/logic'], frontend: true },
    });

    assert.deepEqual(violations, []);
});
