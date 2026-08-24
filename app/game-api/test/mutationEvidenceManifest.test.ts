import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { appRouter } from '../src/router.js';

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const manifestPath = path.join(workspaceRoot, 'docs/architecture/game-api-mutation-evidence.tsv');

const columns = [
    'route',
    'owner_boundary',
    'ref_basis',
    'actor_source',
    'strongest_evidence',
    'evidence_path',
    'remaining_gap',
] as const;

type Column = (typeof columns)[number];
type ManifestRow = Record<Column, string>;

const allowedOwnerBoundaries = new Set([
    'durable-journal',
    'engine-owned',
    'explicit-no-realtime-consumer',
    'external-upload',
    'mixed-saga',
    'operational',
    'read-only-mutation-transport',
    'redis-projection',
    'separate-access-journal',
    'session-only',
]);

const allowedRefBases = new Set(['direct-endpoint', 'domain-command', 'core-only', 'read-only-transport']);

const allowedActorSources = new Set([
    'gateway-token-user',
    'optional-session-db-general',
    'session-admin-role',
    'session-user',
    'session-user-db-general',
    'session-user-engine-general',
]);

const allowedEvidenceLevels = new Set(['dynamic-ref', 'actual-db', 'redis', 'endpoint-unit', 'source-only']);

const expectedOwnerCounts: Record<string, number> = {
    'durable-journal': 19,
    'engine-owned': 38,
    'explicit-no-realtime-consumer': 7,
    'external-upload': 1,
    'mixed-saga': 9,
    operational: 3,
    'read-only-mutation-transport': 2,
    'redis-projection': 6,
    'separate-access-journal': 1,
    'session-only': 1,
};

const parseManifest = (): ManifestRow[] => {
    const [header, ...lines] = readFileSync(manifestPath, 'utf8').trimEnd().split(/\r?\n/u);
    if (header !== columns.join('\t')) {
        throw new Error(`Unexpected mutation evidence manifest header: ${header ?? '<empty>'}`);
    }

    return lines.map((line, index) => {
        const values = line.split('\t');
        if (values.length !== columns.length || values.some((value) => value.length === 0)) {
            throw new Error(`Invalid mutation evidence row at line ${index + 2}.`);
        }
        return Object.fromEntries(columns.map((column, valueIndex) => [column, values[valueIndex]])) as ManifestRow;
    });
};

interface RuntimeProcedureDef {
    type: string;
}

const readRuntimeProcedureDef = (procedure: unknown): RuntimeProcedureDef => {
    if (typeof procedure !== 'function') {
        throw new Error('Mounted tRPC procedure is not callable.');
    }
    const definition: unknown = Reflect.get(procedure, '_def');
    if (typeof definition !== 'object' || definition === null) {
        throw new Error('Mounted tRPC procedure has no runtime definition.');
    }
    const type: unknown = Reflect.get(definition, 'type');
    if (typeof type !== 'string') {
        throw new Error('Mounted tRPC procedure has an unexpected runtime definition.');
    }
    return { type };
};

const mountedMutationNames = (): string[] =>
    Object.entries(appRouter._def.procedures)
        .filter(([, procedure]) => readRuntimeProcedureDef(procedure).type === 'mutation')
        .map(([name]) => name)
        .sort();

describe('game-api mutation evidence manifest', () => {
    it('lists every mounted mutation exactly once', () => {
        const rows = parseManifest();
        const manifestRoutes = rows.map(({ route }) => route);

        expect(rows).toHaveLength(87);
        expect(new Set(manifestRoutes).size).toBe(manifestRoutes.length);
        expect(manifestRoutes).toEqual([...manifestRoutes].sort());
        expect(manifestRoutes).toEqual(mountedMutationNames());
    });

    it('retains the bounded ownership taxonomy and allowed evidence vocabulary', () => {
        const rows = parseManifest();
        const ownerCounts = Object.fromEntries(
            [...allowedOwnerBoundaries].map((owner) => [
                owner,
                rows.filter(({ owner_boundary }) => owner_boundary === owner).length,
            ])
        );

        expect(ownerCounts).toEqual(expectedOwnerCounts);
        for (const row of rows) {
            expect(allowedOwnerBoundaries.has(row.owner_boundary), row.route).toBe(true);
            expect(allowedRefBases.has(row.ref_basis), row.route).toBe(true);
            expect(allowedActorSources.has(row.actor_source), row.route).toBe(true);
            expect(allowedEvidenceLevels.has(row.strongest_evidence), row.route).toBe(true);
            expect(row.remaining_gap, row.route).toMatch(/^[a-z0-9-]+$/u);
            expect(row.evidence_path.startsWith('app/') || row.evidence_path.startsWith('tools/')).toBe(true);
            expect(existsSync(path.join(workspaceRoot, row.evidence_path)), row.route).toBe(true);
        }
    });

    it('records the only unauthenticated mutation boundaries explicitly', () => {
        const rowsByRoute = new Map(parseManifest().map((row) => [row.route, row]));

        expect(rowsByRoute.get('auth.exchangeGatewayToken')?.actor_source).toBe('gateway-token-user');
        expect(rowsByRoute.get('public.recordAccess')?.actor_source).toBe('optional-session-db-general');

        const otherPublicActors = [...rowsByRoute]
            .filter(([route]) => route !== 'auth.exchangeGatewayToken' && route !== 'public.recordAccess')
            .filter(([, row]) => !row.actor_source.startsWith('session-'))
            .map(([route]) => route);
        expect(otherPublicActors).toEqual([]);
    });
});
