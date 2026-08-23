import { describe, expect, it } from 'vitest';

import { ActionResolver } from '../../../src/actions/turn/general/che_하야.js';

describe('che_하야 Ref ordering', () => {
    it('resets belong before refreshing max_belong', () => {
        const general = {
            id: 1,
            name: '하야자',
            nationId: 1,
            cityId: 1,
            troopId: 0,
            npcState: 0,
            experience: 100,
            dedication: 100,
            officerLevel: 5,
            gold: 100,
            rice: 100,
            crew: 0,
            crewTypeId: 0,
            train: 0,
            atmos: 0,
            injury: 0,
            age: 30,
            stats: { leadership: 70, strength: 60, intelligence: 50 },
            role: { items: {} },
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: { belong: 10 },
        };
        const nation = {
            id: 1,
            name: '소속국',
            gold: 1_000,
            rice: 1_000,
            meta: { gennum: 1 },
        };

        const result = new ActionResolver({ defaultNpcGold: 1_000, defaultNpcRice: 1_000 } as never).resolve(
            {
                general,
                nation,
                troopMembers: [],
                addLog: () => {},
            } as never,
            {}
        );
        const generalPatch = result.effects.find(
            (effect) => effect.type === 'general:patch' && effect.targetId === general.id
        );

        expect(generalPatch).toMatchObject({
            type: 'general:patch',
            patch: { meta: { belong: 0, max_belong: 0 } },
        });
    });
});
