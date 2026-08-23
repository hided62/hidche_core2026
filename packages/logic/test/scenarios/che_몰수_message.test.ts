import { describe, expect, it } from 'vitest';

import { ActionDefinition } from '../../src/actions/turn/nation/che_몰수.js';

describe('che_몰수 NPC message icon', () => {
    it('uses the target general non-default shared picture for both payload targets', () => {
        const actor = {
            id: 1,
            name: '집행자',
            nationId: 1,
            cityId: 1,
            troopId: 0,
            stats: { leadership: 70, strength: 60, intelligence: 50 },
            experience: 0,
            dedication: 0,
            officerLevel: 12,
            role: { personality: null, specialDomestic: null, specialWar: null, items: {} },
            injury: 0,
            gold: 0,
            rice: 0,
            crew: 0,
            crewTypeId: 1100,
            train: 0,
            atmos: 0,
            age: 30,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: { killturn: 24 },
        };
        const target = {
            ...actor,
            id: 3,
            name: '몰수NPC',
            gold: 100,
            npcState: 2,
            picture: 'npc/custom.png',
            imageServer: 0,
        };
        const definition = new ActionDefinition({
            npcSeizureMessageProb: 1,
            maxResourceActionAmount: 1_000_000,
        } as never);

        const result = definition.resolve(
            {
                general: actor,
                nation: { id: 1, name: '아국', color: '#123456', gold: 0, rice: 0 },
                destGeneral: target,
                messageTime: new Date('0190-01-01T00:00:00.000Z'),
                messageSharedIconBaseUrl: 'https://ref.example/image/icons',
                rng: {
                    nextBool: () => true,
                    nextInt: () => 0,
                },
            } as never,
            { isGold: true, amount: 100, destGeneralID: target.id }
        );

        expect(result.effects).toContainEqual(
            expect.objectContaining({
                type: 'message:add',
                draft: expect.objectContaining({
                    src: expect.objectContaining({ icon: 'https://ref.example/image/icons/npc/custom.png' }),
                    dest: expect.objectContaining({ icon: 'https://ref.example/image/icons/npc/custom.png' }),
                }),
            })
        );
    });
});
