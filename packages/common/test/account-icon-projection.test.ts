import { describe, expect, it } from 'vitest';

import { resolveAccountIconProjection } from '../src/auth/accountIconProjection.js';

describe('account icon projection', () => {
    it('resolves the current account icon from its durable revision', () => {
        expect(
            resolveAccountIconProjection({
                createdAt: '2026-07-01T00:00:00.000Z',
                iconUpdatedAt: '2026-07-31T09:00:00.000Z',
                picture: 'account.png',
                imageServer: 1,
            })
        ).toEqual({
            revision: '2026-07-31T09:00:00.000Z',
            picture: 'account.png',
            imageServer: 1,
        });
    });

    it('lets an administrator reset win at the same or a later revision', () => {
        expect(
            resolveAccountIconProjection({
                createdAt: '2026-07-01T00:00:00.000Z',
                iconUpdatedAt: '2026-07-31T09:00:00.000Z',
                profileIconResetAt: '2026-07-31T09:00:00.000Z',
                picture: 'account.png',
                imageServer: 1,
            })
        ).toEqual({
            revision: '2026-07-31T09:00:00.000Z',
            picture: 'default.jpg',
            imageServer: 0,
        });
    });

    it.each([
        { createdAt: 'not-a-date', picture: 'account.png', imageServer: 1 },
        { createdAt: '2026-07-31T09:00:00.000Z', picture: '', imageServer: 1 },
        { createdAt: '2026-07-31T09:00:00.000Z', picture: 'account.png', imageServer: -1 },
    ])('rejects invalid durable account icon state: %j', (value) => {
        expect(() => resolveAccountIconProjection(value)).toThrow();
    });
});
