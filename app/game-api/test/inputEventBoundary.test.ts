import { describe, expect, it } from 'vitest';

import { createApiInputPayloadIdentity } from '../src/inputEventBoundary.js';

describe('API input-event payload identity', () => {
    it('hashes canonical JSON independently of object key order', () => {
        expect(
            createApiInputPayloadIdentity({
                second: [{ z: true, a: 1 }],
                first: 'value',
            })
        ).toEqual(
            createApiInputPayloadIdentity({
                first: 'value',
                second: [{ a: 1, z: true }],
            })
        );
    });

    it('distinguishes changed values and array order', () => {
        const original = createApiInputPayloadIdentity({ value: 1, items: ['a', 'b'] });
        expect(createApiInputPayloadIdentity({ value: 2, items: ['a', 'b'] })).not.toEqual(original);
        expect(createApiInputPayloadIdentity({ value: 1, items: ['b', 'a'] })).not.toEqual(original);
    });

    it('stores only a bounded digest envelope for a large or private payload', () => {
        const privatePayload = { dataUrl: `data:image/png;base64,${'A'.repeat(100_000)}`, text: 'private-message' };
        const identity = createApiInputPayloadIdentity(privatePayload);

        expect(identity).toEqual({
            version: 1,
            digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        });
        expect(JSON.stringify(identity)).not.toContain('private-message');
        expect(JSON.stringify(identity).length).toBeLessThan(128);
    });
});
