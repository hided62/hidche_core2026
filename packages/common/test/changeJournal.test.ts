import { describe, expect, it } from 'vitest';

import {
    ChangeJournal,
    createReadModelOutboxPayload,
    normalizeReadModelRevisionKeys,
    READ_MODEL_DOMAINS,
    type ReadModelDomain,
} from '../src/realtime/changeJournal.js';

describe('ChangeJournal', () => {
    it('keeps viewer-filtering semantics as distinct durable domains', () => {
        expect(READ_MODEL_DOMAINS).toEqual(
            expect.arrayContaining([
                'map.general',
                'lobby.general',
                'contacts.world',
                'reserved.general',
                'messages.mailbox',
                'messages.diplomacyMailbox',
                'dashboard.global',
            ])
        );
    });

    it('dedupes keys and returns them in a stable lock order', () => {
        const journal = new ChangeJournal()
            .mark('nation.content', 4)
            .mark('general.content', 9)
            .mark('nation.content', 4)
            .mark('general.content', 2)
            .mark('map.world');

        expect(journal.size).toBe(4);
        expect(journal.snapshot()).toEqual([
            { domain: 'general.content', entityId: 2 },
            { domain: 'general.content', entityId: 9 },
            { domain: 'map.world', entityId: 0 },
            { domain: 'nation.content', entityId: 4 },
        ]);
    });

    it('merges another journal without sharing mutable state', () => {
        const source = new ChangeJournal().mark('records.general', 7);
        const destination = new ChangeJournal().mark('records.global').merge(source);

        source.clear();

        expect(source.isEmpty).toBe(true);
        expect(destination.snapshot()).toEqual([
            { domain: 'records.general', entityId: 7 },
            { domain: 'records.global', entityId: 0 },
        ]);
    });

    it('rejects unknown domains and unstable entity IDs at runtime', () => {
        expect(() => new ChangeJournal().mark('unknown' as ReadModelDomain, 1)).toThrow(TypeError);
        expect(() => new ChangeJournal().mark('general.content', -1)).toThrow(RangeError);
        expect(() => new ChangeJournal().mark('general.content', Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    });
});

describe('durable read-model invalidation contract', () => {
    it('normalizes an arbitrary iterable independently of the collector', () => {
        expect(
            normalizeReadModelRevisionKeys([
                { domain: 'front.nation', entityId: 3 },
                { domain: 'front.global', entityId: 0 },
                { domain: 'front.nation', entityId: 3 },
            ])
        ).toEqual([
            { domain: 'front.global', entityId: 0 },
            { domain: 'front.nation', entityId: 3 },
        ]);
    });

    it('serializes bigint revisions to a compact JSON-safe payload', () => {
        const payload = createReadModelOutboxPayload({
            revisions: [
                { domain: 'world.content', entityId: 0, revision: 12n },
                { domain: 'general.content', entityId: 7, revision: 4n },
            ],
        });

        expect(payload).toEqual({
            version: 1,
            changes: [
                ['general.content', 7, '4'],
                ['world.content', 0, '12'],
            ],
        });
        expect(() => JSON.stringify(payload)).not.toThrow();
    });
});
