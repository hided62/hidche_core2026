import { describe, expect, it } from 'vitest';

import { shouldRunGameApi } from '../src/index.js';

describe('game-api entrypoint', () => {
    it('starts only for an explicitly selected API or worker role', () => {
        expect(shouldRunGameApi('server')).toBe(true);
        expect(shouldRunGameApi('auction-worker')).toBe(true);
        expect(shouldRunGameApi('gateway')).toBe(false);
        expect(shouldRunGameApi(undefined)).toBe(false);
    });
});
