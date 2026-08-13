import { describe, expect, it } from 'vitest';

import {
    buildGatewayProfileName,
    resolveGatewayProfileIdentity,
    type GatewayProfileUpsertInput,
} from '../src/orchestrator/profileRepository.js';

const resolve = (input: Partial<GatewayProfileUpsertInput>) =>
    resolveGatewayProfileIdentity({
        profile: 'che',
        apiPort: 15003,
        ...input,
    });

describe('Gateway profile identity', () => {
    it('builds the immutable technical id from profile and instance key', () => {
        expect(buildGatewayProfileName('che', 'default')).toBe('che:default');
    });

    it('does not treat a new default instance as an initialized scenario', () => {
        expect(resolve({ instanceKey: 'default' })).toEqual({
            instanceKey: 'default',
            currentScenario: null,
            shouldUpdateCurrentScenario: false,
        });
    });

    it('accepts the old bootstrap default marker without clearing an existing scenario on upsert', () => {
        expect(resolve({ scenario: 'default' })).toEqual({
            instanceKey: 'default',
            currentScenario: null,
            shouldUpdateCurrentScenario: false,
        });
    });

    it('maps a legacy non-default scenario to both identity and current state', () => {
        expect(resolve({ scenario: '2' })).toEqual({
            instanceKey: '2',
            currentScenario: '2',
            shouldUpdateCurrentScenario: true,
        });
    });

    it('keeps a default instance stable when its current scenario changes', () => {
        expect(resolve({ instanceKey: 'default', currentScenario: '1010' })).toEqual({
            instanceKey: 'default',
            currentScenario: '1010',
            shouldUpdateCurrentScenario: true,
        });
    });
});
