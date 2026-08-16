import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../src/context.js';
import { readDashboardSourceRevisionState } from '../src/services/dashboardSourceRevision.js';

const row = (overrides: Record<string, unknown> = {}) => ({
    generalId: 7,
    cityId: 3,
    nationId: 2,
    coverageVersion: 1,
    generalRevision: 11n,
    cityRevision: 12n,
    nationRevision: 13n,
    worldRevision: 14n,
    accessRevision: 15n,
    ...overrides,
});

const read = async (value: unknown) => {
    const queryRaw = vi.fn(async (_query: unknown) => value);
    const state = await readDashboardSourceRevisionState({ $queryRaw: queryRaw } as Pick<DatabaseClient, '$queryRaw'>, 7);
    return { queryRaw, state };
};

describe('dashboard source revision', () => {
    it('uses zero for missing revision rows and returns opaque 22-character hashes', async () => {
        const { queryRaw, state } = await read([
            row({
                generalRevision: 0n,
                cityRevision: 0n,
                nationRevision: 0n,
                worldRevision: 0n,
                accessRevision: 0n,
            }),
        ]);

        expect(state?.coverageVersion).toBe(1);
        expect(Object.values(state?.sourceRevisions ?? {})).toEqual([
            expect.stringMatching(/^[A-Za-z0-9_-]{22}$/u),
            expect.stringMatching(/^[A-Za-z0-9_-]{22}$/u),
            expect.stringMatching(/^[A-Za-z0-9_-]{22}$/u),
        ]);
        const statement = queryRaw.mock.calls[0]?.[0] as { sql: string };
        expect(statement.sql.match(/COALESCE\([^)]*\."revision", 0\)/gu)).toHaveLength(5);
    });

    it('hashes exactly the documented context, command, and board dependency vectors', async () => {
        const initial = (await read([row()])).state;
        const cityChanged = (await read([row({ cityRevision: 99n })])).state;
        const accessChanged = (await read([row({ accessRevision: 99n })])).state;
        const worldChanged = (await read([row({ worldRevision: 99n })])).state;
        const nationChanged = (await read([row({ nationRevision: 99n })])).state;
        if (!initial || !cityChanged || !accessChanged || !worldChanged || !nationChanged) {
            throw new Error('source revision state missing');
        }

        expect(cityChanged.sourceRevisions.context).not.toBe(initial.sourceRevisions.context);
        expect(cityChanged.sourceRevisions.commandTable).not.toBe(initial.sourceRevisions.commandTable);
        expect(cityChanged.sourceRevisions.boardAccess).toBe(initial.sourceRevisions.boardAccess);
        expect(accessChanged.sourceRevisions.context).not.toBe(initial.sourceRevisions.context);
        expect(accessChanged.sourceRevisions.commandTable).toBe(initial.sourceRevisions.commandTable);
        expect(accessChanged.sourceRevisions.boardAccess).toBe(initial.sourceRevisions.boardAccess);
        expect(worldChanged.sourceRevisions.context).not.toBe(initial.sourceRevisions.context);
        expect(worldChanged.sourceRevisions.commandTable).not.toBe(initial.sourceRevisions.commandTable);
        expect(worldChanged.sourceRevisions.boardAccess).toBe(initial.sourceRevisions.boardAccess);
        expect(nationChanged.sourceRevisions.context).not.toBe(initial.sourceRevisions.context);
        expect(nationChanged.sourceRevisions.commandTable).not.toBe(initial.sourceRevisions.commandTable);
        expect(nationChanged.sourceRevisions.boardAccess).not.toBe(initial.sourceRevisions.boardAccess);
    });

    it('rejects missing meta/actor rows, malformed values, and query failures', async () => {
        await expect(read([])).resolves.toMatchObject({ state: null });
        await expect(read([row({ coverageVersion: -1 })])).resolves.toMatchObject({ state: null });
        await expect(read([row({ generalRevision: 'not-a-revision' })])).resolves.toMatchObject({ state: null });
        await expect(read([row({ generalRevision: true })])).resolves.toMatchObject({ state: null });

        const db = {
            $queryRaw: vi.fn(async () => Promise.reject(new Error('query failed'))),
        } as unknown as Pick<DatabaseClient, '$queryRaw'>;
        await expect(readDashboardSourceRevisionState(db, 7)).resolves.toBeNull();
    });
});
