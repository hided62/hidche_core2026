import { describe, expect, it } from 'vitest';
import { LEGACY_RANK_DATA_TYPES, RANK_DATA_TYPES } from '@sammo-ts/common';

import {
    applyPersistedRankRowsToMeta,
    buildLegacyComparableRankRows,
    buildPersistedRankRows,
    rankMetaKey,
} from '../src/turn/rankData.js';

describe('rank data projection', () => {
    it('projects every core row while preserving legacy key and integer semantics', () => {
        const rows = buildPersistedRankRows({
            id: 7,
            nationId: 2,
            experience: 10.5,
            dedication: 20.49,
            meta: {
                rank_warnum: '3.5',
                ttw: 4.5,
                inherit_earned: '9',
                dex1: 12,
            },
        });

        expect(rows).toHaveLength(RANK_DATA_TYPES.length);
        expect(rows).toEqual(
            expect.arrayContaining([
                { generalId: 7, nationId: 2, type: 'experience', value: 11 },
                { generalId: 7, nationId: 2, type: 'dedication', value: 20 },
                { generalId: 7, nationId: 2, type: 'warnum', value: 4 },
                { generalId: 7, nationId: 2, type: 'ttw', value: 5 },
                { generalId: 7, nationId: 2, type: 'inherit_earned', value: 9 },
                { generalId: 7, nationId: 2, type: 'dex1', value: 12 },
            ])
        );
        expect(buildLegacyComparableRankRows({
            id: 7,
            nationId: 2,
            experience: 10.5,
            dedication: 20.49,
            meta: {},
        })).toHaveLength(LEGACY_RANK_DATA_TYPES.length);
    });

    it('loads persisted rows into the same raw and prefixed meta keys used by commands', () => {
        const meta: Record<string, unknown> = {};
        applyPersistedRankRowsToMeta(meta, [
            { type: 'warnum', value: 3 },
            { type: 'ttw', value: 4 },
            { type: 'inherit_spent', value: 5 },
            { type: 'dex1', value: 6 },
            { type: 'unknown', value: 99 },
        ]);

        expect(meta).toEqual({
            rank_warnum: 3,
            ttw: 4,
            inherit_spent: 5,
            dex1: 6,
        });
        expect(rankMetaKey('warnum')).toBe('rank_warnum');
        expect(rankMetaKey('betgold')).toBe('betgold');
    });
});
