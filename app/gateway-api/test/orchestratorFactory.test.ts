import { describe, expect, it } from 'vitest';

import { buildEnvMap } from '../src/orchestrator/orchestratorFactory.js';

describe('buildEnvMap', () => {
    it('removes PM2 child identity before creating Git and profile process environments', () => {
        expect(
            buildEnvMap({
                DATABASE_URL: 'postgresql://integration.invalid/sammo',
                GATEWAY_ROLE: 'orchestrator',
                pm_id: '2',
                pm_exec_path: '/workspace/core2026/app/gateway-api/dist/index.js',
                name: 'sammo:gateway-orchestrator',
                axm_dynamic: '{}',
            })
        ).toEqual({ DATABASE_URL: 'postgresql://integration.invalid/sammo' });
    });
});
