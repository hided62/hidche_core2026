import { describe, expect, it } from 'vitest';

import {
    GATEWAY_PROFILE_KOREAN_NAMES,
    GATEWAY_PROFILE_ORDER,
    orderGatewayProfiles,
    resolveGatewayProfileKoreanName,
} from '../src/profileOrder.js';

describe('orderGatewayProfiles', () => {
    it('uses the public server order instead of alphabetical profile order', () => {
        const profiles = ['hwe', 'pya', 'che', 'nya', 'twe', 'pwe', 'kwe'].map((profile) => ({
            profile,
            instanceKey: 'default',
        }));

        expect(orderGatewayProfiles(profiles).map(({ profile }) => profile)).toEqual(GATEWAY_PROFILE_ORDER);
    });

    it('orders instance keys within a profile and places unknown profiles afterward', () => {
        const profiles = [
            { profile: 'zeta', instanceKey: 'default' },
            { profile: 'che', instanceKey: '20' },
            { profile: 'alpha', instanceKey: 'default' },
            { profile: 'che', instanceKey: '10' },
        ];

        expect(orderGatewayProfiles(profiles)).toEqual([
            { profile: 'che', instanceKey: '10' },
            { profile: 'che', instanceKey: '20' },
            { profile: 'alpha', instanceKey: 'default' },
            { profile: 'zeta', instanceKey: 'default' },
        ]);
        expect(profiles[0]?.profile).toBe('zeta');
    });
});

describe('resolveGatewayProfileKoreanName', () => {
    it('uses the canonical Korean labels for every public profile', () => {
        expect(GATEWAY_PROFILE_ORDER.map((profile) => resolveGatewayProfileKoreanName(profile))).toEqual(
            GATEWAY_PROFILE_ORDER.map((profile) => GATEWAY_PROFILE_KOREAN_NAMES[profile])
        );
        expect(GATEWAY_PROFILE_ORDER.map((profile) => `${resolveGatewayProfileKoreanName(profile)}섭`)).toEqual([
            '체섭',
            '퀘섭',
            '풰섭',
            '퉤섭',
            '냐섭',
            '퍄섭',
            '훼섭',
        ]);
    });

    it('preserves configured and unknown profile names', () => {
        expect(resolveGatewayProfileKoreanName('che', ' 천하서버 ')).toBe('천하서버');
        expect(resolveGatewayProfileKoreanName('custom')).toBe('custom');
    });
});
