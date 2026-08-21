import { describe, expect, it } from 'vitest';

import { resolveProfileFirstGameIdx } from '../src/orchestrator/gatewayOrchestrator.js';

describe('profile first game index', () => {
    it('preserves an explicitly configured zero', () => {
        expect(resolveProfileFirstGameIdx({ firstGameIdx: 0 })).toBe(0);
    });

    it('defaults missing or invalid metadata to one', () => {
        expect(resolveProfileFirstGameIdx({})).toBe(1);
        expect(resolveProfileFirstGameIdx({ firstGameIdx: -1 })).toBe(1);
        expect(resolveProfileFirstGameIdx({ firstGameIdx: 0.5 })).toBe(1);
        expect(resolveProfileFirstGameIdx({ firstGameIdx: 'invalid' })).toBe(1);
    });
});
