import { describe, expect, it } from 'vitest';

import { shouldRunGateway } from '../src/index.js';

describe('gateway entrypoint', () => {
    it('starts only for an explicitly selected Gateway role', () => {
        expect(shouldRunGateway('api')).toBe(true);
        expect(shouldRunGateway('orchestrator')).toBe(true);
        expect(shouldRunGateway('profile-seed')).toBe(true);
        expect(shouldRunGateway('server')).toBe(false);
        expect(shouldRunGateway(undefined)).toBe(false);
    });
});
