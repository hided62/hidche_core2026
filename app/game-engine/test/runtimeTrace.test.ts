import { describe, expect, it, vi } from 'vitest';

import { createRuntimeTrace } from '../src/turn/runtimeTrace.js';

describe('runtime trace adapter', () => {
    it('maps environment filters to domain trace subjects', () => {
        const trace = createRuntimeTrace({
            CORE_AI_TRACE_GENERAL_IDS: '3,7',
            CORE_AI_TRACE_NATION_IDS: '11',
            CORE_WAR_TECH_TRACE_NATION_IDS: '13',
            CORE_BATTLE_FIXTURE_TRACE: '1',
        });

        expect(trace.isEnabled('AI_ACTION_PATCH_TRACE', { generalIds: [7] })).toBe(true);
        expect(trace.isEnabled('AI_ACTION_PATCH_TRACE', { nationIds: [11] })).toBe(true);
        expect(trace.isEnabled('AI_WAR_TRACE', { generalIds: [3] })).toBe(true);
        expect(trace.isEnabled('WAR_TECH_TRACE', { nationIds: [13] })).toBe(true);
        expect(trace.isEnabled('AI_WAR_FIXTURE_CORE')).toBe(true);
        expect(trace.isEnabled('AI_WAR_TRACE', { generalIds: [9] })).toBe(false);
        expect(
            createRuntimeTrace({ CORE_AI_TRACE_GENERAL_IDS: ' 7' }).isEnabled('AI_WAR_TRACE', { generalIds: [7] })
        ).toBe(false);
    });

    it('preserves the legacy line protocol', () => {
        const write = vi.fn();
        const trace = createRuntimeTrace({}, write);

        trace.write('AI_WAR_TRACE', { generalId: 7 });

        expect(write).toHaveBeenCalledWith('AI_WAR_TRACE {"generalId":7}\n');
    });
});
