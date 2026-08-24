import { describe, expect, it } from 'vitest';

import { buildInheritanceSettlementLogTexts } from '../src/turn/inheritanceSettlementLogs.js';

describe('legacy inheritance settlement logs', () => {
    it('logs calculated keys plus only direct stored keys that are present, in Ref order', () => {
        expect(
            buildInheritanceSettlementLogTexts({
                previous: 100,
                points: {
                    lived_month: 12,
                    max_belong: 90,
                    max_domestic_critical: 80,
                    active_action: 3,
                    combat: 15,
                    sabotage: 40,
                    unifier: 250,
                    dex: 1.25,
                    tournament: 50,
                    betting: 5,
                },
                storedKeys: new Set(['previous', 'lived_month', 'unifier']),
                total: 521,
                isRebirth: false,
            })
        ).toEqual([
            '기존 보유 포인트 100 증가',
            '생존 포인트 12 증가',
            '최대 임관년 수 포인트 90 증가',
            '전투 횟수 포인트 15 증가',
            '계략 성공 횟수 포인트 40 증가',
            '천통 기여 포인트 250 증가',
            '숙련도 포인트 1.25 증가',
            '베팅 당첨 포인트 5 증가',
            '포인트 100 => 521',
        ]);
    });

    it('skips delayed rebirth keys and logs coefficient-adjusted values', () => {
        expect(
            buildInheritanceSettlementLogTexts({
                previous: 50,
                points: {
                    lived_month: 12,
                    max_belong: 0,
                    max_domestic_critical: 0,
                    active_action: 3,
                    combat: 15,
                    sabotage: 40,
                    unifier: 0,
                    dex: 0.5,
                    tournament: 7,
                    betting: 5,
                },
                storedKeys: new Set([
                    'previous',
                    'lived_month',
                    'max_domestic_critical',
                    'active_action',
                    'unifier',
                    'tournament',
                ]),
                total: 132,
                isRebirth: true,
            })
        ).toEqual([
            '기존 보유 포인트 50 증가',
            '생존 포인트 12 증가',
            '능동 행동 수 포인트 3 증가',
            '전투 횟수 포인트 15 증가',
            '계략 성공 횟수 포인트 40 증가',
            '숙련도 포인트 0.5 증가',
            '토너먼트 포인트 7 증가',
            '베팅 당첨 포인트 5 증가',
            '포인트 50 => 132',
        ]);
    });
});
