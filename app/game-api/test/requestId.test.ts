import { describe, expect, it } from 'vitest';

import { scopeHttpIdempotencyKey } from '../src/requestId.js';
import { scopeApiInputEventRequestId } from '../src/trpc.js';

describe('HTTP idempotency request IDs', () => {
    it('is stable for one principal and isolated across users and profiles', () => {
        const first = scopeHttpIdempotencyKey({ rawKey: 'same-client-key', profileId: 'hwe', userId: 'user-a' });
        expect(first).toBe(scopeHttpIdempotencyKey({ rawKey: 'same-client-key', profileId: 'hwe', userId: 'user-a' }));
        expect(first).not.toBe(
            scopeHttpIdempotencyKey({ rawKey: 'same-client-key', profileId: 'hwe', userId: 'user-b' })
        );
        expect(first).not.toBe(
            scopeHttpIdempotencyKey({ rawKey: 'same-client-key', profileId: 'che', userId: 'user-a' })
        );
    });

    it('bounds and neutralizes untrusted header content while omitting blank keys', () => {
        expect(scopeHttpIdempotencyKey({ rawKey: ' \n\t ', profileId: 'hwe', userId: 'user-a' })).toBeUndefined();
        const scoped = scopeHttpIdempotencyKey({
            rawKey: `${'x'.repeat(10_000)}:../../unexpected`,
            profileId: 'hwe',
            userId: null,
        });
        expect(scoped).toMatch(/^http:[0-9a-f]{64}$/u);
        expect(scoped).toHaveLength(69);
    });

    it('keeps the first call compatible and isolates later calls in a same-path batch', () => {
        expect(scopeApiInputEventRequestId('http:base', 'messages.send', 0)).toBe('http:base:messages.send');
        expect(scopeApiInputEventRequestId('http:base', 'messages.send', 1)).toBe('http:base:messages.send:batch:1');
        expect(scopeApiInputEventRequestId('http:base', 'messages.send', 2)).not.toBe(
            scopeApiInputEventRequestId('http:base', 'messages.send', 1)
        );
    });
});
