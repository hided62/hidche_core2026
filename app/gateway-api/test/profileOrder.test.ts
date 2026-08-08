import { describe, expect, it } from 'vitest';

import { GATEWAY_PROFILE_ORDER, orderGatewayProfiles } from '../src/profileOrder.js';

describe('orderGatewayProfiles', () => {
    it('uses the public server order instead of alphabetical profile order', () => {
        const profiles = ['hwe', 'pya', 'che', 'nya', 'twe', 'pwe', 'kwe'].map((profile) => ({
            profile,
            scenario: 'default',
        }));

        expect(orderGatewayProfiles(profiles).map(({ profile }) => profile)).toEqual(GATEWAY_PROFILE_ORDER);
    });

    it('orders scenarios within a profile and places unknown profiles afterward', () => {
        const profiles = [
            { profile: 'zeta', scenario: 'default' },
            { profile: 'che', scenario: '20' },
            { profile: 'alpha', scenario: 'default' },
            { profile: 'che', scenario: '10' },
        ];

        expect(orderGatewayProfiles(profiles)).toEqual([
            { profile: 'che', scenario: '10' },
            { profile: 'che', scenario: '20' },
            { profile: 'alpha', scenario: 'default' },
            { profile: 'zeta', scenario: 'default' },
        ]);
        expect(profiles[0]?.profile).toBe('zeta');
    });
});
