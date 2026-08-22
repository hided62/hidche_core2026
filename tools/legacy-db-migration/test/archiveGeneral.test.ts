import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { normalizeArchivedGeneral, type ArchivedJsonValue } from '@sammo-ts/common';

const fixture = async (name: string): Promise<ArchivedJsonValue> =>
    JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as ArchivedJsonValue;

describe('normalizeArchivedGeneral', () => {
    it('normalizes the sanitized CHE legacy-flat keyset without leaking connection metadata', async () => {
        const { sourceFormat, snapshot } = normalizeArchivedGeneral(
            await fixture('che-old-general-legacy-flat-v0.json'),
            'fallback'
        );

        expect(sourceFormat).toBe('legacy-flat-v0');
        expect(snapshot).toMatchObject({
            schemaVersion: 1,
            identity: { name: '구형테스트장수', nationId: 3 },
            stats: { leadership: 81, strength: 73, intelligence: 66 },
            mastery: { infantry: 101, archery: 202, cavalry: 303, special: 404, siege: 505 },
            battle: {
                battles: 20,
                wins: 12,
                losses: 8,
                winRate: 60,
                killRate: 125,
                tactics: { total: { wins: 3, draws: 1, losses: 2 } },
            },
            history: ['<C>●</>첫 기록', '<Y>●</>둘째 기록'],
            availability: { mastery: true, battleAggregates: true, tactics: true },
        });
        expect(JSON.stringify(snapshot)).not.toMatch(/"(?:ip|lastconnect|refresh)"/iu);
    });

    it('normalizes the sanitized HWE ref-flat keyset and marks absent battle records unavailable', async () => {
        const { sourceFormat, snapshot } = normalizeArchivedGeneral(
            await fixture('hwe-old-general-ref-flat-v1.json'),
            'fallback'
        );

        expect(sourceFormat).toBe('ref-flat-v1');
        expect(snapshot).toMatchObject({
            identity: { name: '신형테스트장수', officerLevel: 7 },
            stats: {
                leadership: 91,
                strength: 82,
                intelligence: 74,
                leadershipExperience: 11,
            },
            traits: { personality: 'che_의리', specialDomestic: 'che_상재', specialWar: 'che_신산' },
            mastery: { infantry: 111, archery: 222, cavalry: 333, special: 444, siege: 555 },
            battle: { battles: null, wins: null, losses: null, winRate: null, killRate: null },
            availability: { mastery: true, battleAggregates: false, tactics: false },
        });
        expect(snapshot.availability.battleDetailLogs).toBe(false);
        expect(snapshot.availability.battleResultLogs).toBe(false);
    });

    it('keeps an already-normalized version 1 snapshot stable', async () => {
        const first = normalizeArchivedGeneral(await fixture('che-old-general-legacy-flat-v0.json'), 'fallback');
        const second = normalizeArchivedGeneral(
            first.snapshot as unknown as ArchivedJsonValue,
            first.snapshot.identity.name
        );

        expect(second.sourceFormat).toBe('core-snapshot-v1');
        expect(second.snapshot).toEqual(first.snapshot);
    });

    it('recovers Core rank/mastery projections and preserved battle results from a raw past-play snapshot', () => {
        const { sourceFormat, snapshot } = normalizeArchivedGeneral(
            {
                name: '현재기수장수',
                stats: { leadership: 88, strength: 77, intelligence: 66 },
                meta: {
                    dex1: 1_100,
                    dex2: 2_200,
                    dex3: 3_300,
                    dex4: 4_400,
                    dex5: 5_500,
                    rank_warnum: 15,
                    rank_killnum: 9,
                    rank_deathnum: 6,
                    rank_firenum: 4,
                    rank_killcrew: 12_345,
                    rank_deathcrew: 6_789,
                    rank_ttw: 3,
                    rank_ttd: 2,
                    rank_ttl: 1,
                },
                records: { battleResult: ['둘째 전투', '첫째 전투'] },
                availability: { battleResultLogs: true },
            },
            'fallback'
        );

        expect(sourceFormat).toBe('core-snapshot-v1');
        expect(snapshot).toMatchObject({
            mastery: { infantry: 1_100, archery: 2_200, cavalry: 3_300, special: 4_400, siege: 5_500 },
            battle: {
                battles: 15,
                wins: 9,
                losses: 6,
                fireSuccesses: 4,
                killedCrew: 12_345,
                lostCrew: 6_789,
                winRate: 60,
                tactics: { total: { wins: 3, draws: 2, losses: 1 } },
            },
            records: { battleResult: ['둘째 전투', '첫째 전투'] },
            availability: {
                mastery: true,
                battleAggregates: true,
                tactics: true,
                battleDetailLogs: false,
                battleResultLogs: true,
            },
        });
    });
});
