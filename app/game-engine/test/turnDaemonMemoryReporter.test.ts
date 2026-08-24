import { describe, expect, it } from 'vitest';

import { buildTurnDaemonMemoryReport } from '../src/turn/turnDaemonMemoryReporter.js';

const context = {
    year: 214,
    month: 12,
    generals: 2461,
    cities: 78,
    nations: 3,
    troops: 15,
    events: 4,
    lifecycleState: 'paused',
};

describe('turn daemon memory reporting', () => {
    it('reports bounded process and world-size fields without inspecting or cloning entities', () => {
        const result = buildTurnDaemonMemoryReport(
            'hwe',
            'interval',
            context,
            {
                rss: 1_258_291_200,
                heapTotal: 1_100_000_000,
                heapUsed: 900_000_000,
                external: 20_000_000,
                arrayBuffers: 10_000_000,
            },
            3_221_225_472
        );

        expect(result.warning).toBe(false);
        expect(result.message).toContain('profile=hwe reason=interval');
        expect(result.message).toContain('heapLimitMiB=3072');
        expect(result.message).toContain('year=214 month=12 generals=2461');
        expect(result.message).toContain('lifecycle=paused');
    });

    it('marks samples at or above 80 percent of the V8 heap limit as warnings', () => {
        const result = buildTurnDaemonMemoryReport(
            'hwe',
            'interval',
            context,
            {
                rss: 1_500_000_000,
                heapTotal: 1_400_000_000,
                heapUsed: 1_288_490_189,
                external: 0,
                arrayBuffers: 0,
            },
            1_610_612_736
        );

        expect(result.warning).toBe(true);
    });
});
