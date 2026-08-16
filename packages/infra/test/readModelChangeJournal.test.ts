import { describe, expect, it, vi } from 'vitest';

import type { GamePrisma } from '../src/gamePrisma.js';
import { writeReadModelChangeJournal } from '../src/readModelChangeJournal.js';

const createTransaction = (rows: readonly object[]) => {
    const queryRaw = vi.fn().mockResolvedValue(rows);
    return {
        transaction: { $queryRaw: queryRaw } as unknown as GamePrisma.TransactionClient,
        queryRaw,
    };
};

describe('writeReadModelChangeJournal', () => {
    it('dedupes keys, writes one statement, and returns committed revisions', async () => {
        const { transaction, queryRaw } = createTransaction([
            { domain: 'general.content', entityId: 3, revision: 8n, outboxId: 41n },
            { domain: 'map.world', entityId: 0, revision: 2n, outboxId: 41n },
        ]);

        const result = await writeReadModelChangeJournal(transaction, [
            { domain: 'map.world', entityId: 0 },
            { domain: 'general.content', entityId: 3 },
            { domain: 'map.world', entityId: 0 },
        ]);

        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            invalidation: {
                revisions: [
                    { domain: 'general.content', entityId: 3, revision: 8n },
                    { domain: 'map.world', entityId: 0, revision: 2n },
                ],
            },
            outboxId: 41n,
        });
    });

    it('does not touch the transaction for an empty journal', async () => {
        const { transaction, queryRaw } = createTransaction([]);

        await expect(writeReadModelChangeJournal(transaction, [])).resolves.toBeNull();
        expect(queryRaw).not.toHaveBeenCalled();
    });

    it('rejects a malformed database receipt instead of publishing partial state', async () => {
        const { transaction } = createTransaction([
            { domain: 'general.content', entityId: 4, revision: 1n, outboxId: 1n },
        ]);

        await expect(
            writeReadModelChangeJournal(transaction, [{ domain: 'general.content', entityId: 3 }])
        ).rejects.toThrow('unexpected key order');
    });
});
