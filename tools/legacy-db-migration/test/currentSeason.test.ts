import { describe, expect, it } from 'vitest';

import { transformLegacyMessagePayload } from '../src/currentSeason.js';

describe('transformLegacyMessagePayload', () => {
    it('renames legacy target fields while preserving the message', () => {
        expect(
            transformLegacyMessagePayload(
                JSON.stringify({
                    src: {
                        id: 44,
                        name: '⭕곽i사',
                        nation_id: 42,
                        nation: '주네핑',
                        color: '#ffffff',
                        icon: '/image/icons/default.jpg',
                    },
                    dest: {
                        id: 0,
                        name: '',
                        nation_id: 0,
                        nation: 'System',
                        color: '#000000',
                        icon: '/image/icons/default.jpg',
                    },
                    text: '테스트 메시지',
                    option: [],
                })
            )
        ).toEqual({
            src: {
                generalId: 44,
                generalName: '⭕곽i사',
                nationId: 42,
                nationName: '주네핑',
                color: '#ffffff',
                icon: '/image/icons/default.jpg',
            },
            dest: {
                generalId: 0,
                generalName: '',
                nationId: 0,
                nationName: 'System',
                color: '#000000',
                icon: '/image/icons/default.jpg',
            },
            text: '테스트 메시지',
        });
    });
});
