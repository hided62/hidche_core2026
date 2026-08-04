import { describe, expect, it } from 'vitest';

import { shouldRunTurnDaemon } from '../src/index.js';

describe('game-engine entrypoint', () => {
    it('starts only for an explicitly selected turn-daemon role', () => {
        expect(shouldRunTurnDaemon('turn-daemon')).toBe(true);
        expect(shouldRunTurnDaemon('api')).toBe(false);
        expect(shouldRunTurnDaemon(undefined)).toBe(false);
    });
});
