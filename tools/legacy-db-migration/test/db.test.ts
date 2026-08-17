import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { quoteQualifiedIdentifier, upsertRows } from '../src/db.js';

describe('qualified archive identifiers', () => {
    it('quotes a schema-qualified table and still parameterizes values', async () => {
        const query = vi.fn().mockResolvedValue({});
        await upsertRows(
            { query } as unknown as PoolClient,
            'legacy_archive.general',
            [{ id: 1, data: { ok: true } }],
            ['id']
        );
        expect(query).toHaveBeenCalledOnce();
        expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO "legacy_archive"."general"');
        expect(query.mock.calls[0]?.[1]).toEqual([1, JSON.stringify({ ok: true })]);
    });

    it.each(['legacy_archive.general.extra', 'legacy-archive.general', 'legacy_archive.General', 'public.;drop'])(
        'rejects unsafe qualified identifier %s',
        (value) => expect(() => quoteQualifiedIdentifier(value)).toThrow('Unsafe SQL identifier')
    );
});
