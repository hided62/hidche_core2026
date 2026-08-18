import { describe, expect, it } from 'vitest';
import { GATEWAY_PROFILE_STATUSES, gatewayProfileCapabilities } from '../src/gateway/profileStatus.js';

describe('gateway profile status capabilities', () => {
    it('keeps PAUSED accessible while stopping only turn execution', () => {
        expect(gatewayProfileCapabilities('PAUSED')).toEqual({
            runtimeExpected: true,
            userAccessible: true,
            turnsRunning: false,
            operatorResumable: true,
        });
    });

    it('keeps STOPPED inaccessible while allowing an operator restart', () => {
        expect(gatewayProfileCapabilities('STOPPED')).toEqual({
            runtimeExpected: false,
            userAccessible: false,
            turnsRunning: false,
            operatorResumable: true,
        });
    });

    it('defines capabilities for every persisted status', () => {
        expect(GATEWAY_PROFILE_STATUSES.map((status) => gatewayProfileCapabilities(status))).toHaveLength(8);
    });
});
