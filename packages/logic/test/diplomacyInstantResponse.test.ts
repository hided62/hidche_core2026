import { describe, expect, it } from 'vitest';

import type { Nation } from '../src/domain/entities.js';
import { buildNationFrontStatePatches, resolveInstantDiplomacyResponse } from '../src/diplomacy/index.js';
import { LogCategory, LogScope } from '../src/logging/types.js';

const nation = (id: number, name: string, meta: Nation['meta'] = {}): Nation => ({
    id,
    name,
    color: '#000000',
    capitalCityId: id,
    chiefGeneralId: id,
    gold: 1000,
    rice: 1000,
    power: 0,
    level: 1,
    typeCode: 'test',
    meta,
});

const context = {
    actor: { id: 11, name: '수락자', nationId: 1 },
    actorNation: nation(1, '위'),
    proposer: { id: 22, name: '제안자', nationId: 2 },
    proposerNation: nation(2, '촉', {
        recv_assist: { n1: [1, 345] },
        resp_assist: { n3: [3, 100] },
    }),
    currentYear: 200,
    currentMonth: 3,
};

describe('instant diplomatic response parity', () => {
    it('creates the legacy non-aggression term, assistance response, and both general logs', () => {
        const result = resolveInstantDiplomacyResponse(context, {
            action: 'noAggression',
            treatyYear: 201,
            treatyMonth: 2,
        });

        expect(result.actionKey).toBe('che_불가침수락');
        expect(result.diplomacyDetail).toBe('201년 2월까지 불가침 합의');
        expect(result.effects.filter((effect) => effect.type === 'diplomacy:patch')).toEqual([
            {
                type: 'diplomacy:patch',
                srcNationId: 1,
                destNationId: 2,
                patch: { state: 7, term: 12 },
            },
            {
                type: 'diplomacy:patch',
                srcNationId: 2,
                destNationId: 1,
                patch: { state: 7, term: 12 },
            },
        ]);
        expect(result.effects).toContainEqual({
            type: 'nation:patch',
            targetId: 2,
            patch: {
                meta: {
                    recv_assist: { n1: [1, 345] },
                    resp_assist: { n3: [3, 100], n1: [1, 345] },
                },
            },
        });
        const logs = result.effects.filter((effect) => effect.type === 'log');
        expect(logs).toHaveLength(4);
        expect(logs.map((effect) => effect.entry.generalId)).toEqual([11, 11, 22, 22]);
    });

    it('creates the full legacy cancellation logs without refreshing fronts', () => {
        const result = resolveInstantDiplomacyResponse(context, { action: 'cancelNA' });
        const logs = result.effects.filter((effect) => effect.type === 'log');

        expect(result.actionKey).toBe('che_불가침파기수락');
        expect(result.refreshFront).toBe(false);
        expect(logs).toHaveLength(6);
        expect(logs).toContainEqual(
            expect.objectContaining({
                entry: expect.objectContaining({
                    scope: LogScope.SYSTEM,
                    category: LogCategory.SUMMARY,
                }),
            })
        );
    });

    it('creates both nation histories and requests front refresh for stop-war', () => {
        const result = resolveInstantDiplomacyResponse(context, { action: 'stopWar' });
        const nationLogIds = result.effects.flatMap((effect) =>
            effect.type === 'log' && effect.entry.scope === LogScope.NATION ? [effect.entry.nationId] : []
        );

        expect(result.actionKey).toBe('che_종전수락');
        expect(result.refreshFront).toBe(true);
        expect(nationLogIds).toEqual([1, 2]);
    });

    it('recomputes only requested nation fronts with legacy priority', () => {
        const patches = buildNationFrontStatePatches({
            cities: [
                { id: 1, nationId: 1, frontState: 3 },
                { id: 2, nationId: 2, frontState: 3 },
                { id: 3, nationId: 0, frontState: 0 },
            ],
            diplomacy: [
                { fromNationId: 1, toNationId: 2, state: 2, term: 0 },
                { fromNationId: 2, toNationId: 1, state: 2, term: 0 },
            ],
            connections: new Map([
                [1, [2, 3]],
                [2, [1]],
                [3, [1]],
            ]),
            nationIds: [1, 2],
        });

        expect(patches).toEqual([
            { id: 1, frontState: 2 },
            { id: 2, frontState: 0 },
        ]);
    });
});
