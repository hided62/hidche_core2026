import { describe, expect, it } from 'vitest';

import { ActionResolver, actionContextBuilder } from '../../../src/actions/turn/general/che_등용.js';

describe('che_등용 recruitment message', () => {
    it('queues the Ref scout prompt with sender and receiver snapshots', () => {
        const logs: unknown[] = [];
        const general = {
            id: 1,
            name: '등용자',
            nationId: 1,
            cityId: 1,
            troopId: 0,
            gold: 5_000,
            experience: 100,
            dedication: 100,
            stats: { leadership: 70, strength: 60, intelligence: 50 },
            role: { items: {} },
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        };
        const destination = {
            ...general,
            id: 2,
            name: '수신자',
            nationId: 2,
            experience: 300,
            dedication: 200,
        };
        const sourceNation = { id: 1, name: '위', color: '#ffffff' };
        const destinationNation = { id: 2, name: '촉', color: '#000000' };
        const messageTime = new Date('0200-01-01T00:10:00.000Z');
        const actorTurnTime = new Date('0200-01-01T00:00:00.000Z');

        const builtContext = actionContextBuilder(
            {
                general: { ...general, turnTime: actorTurnTime },
                nation: sourceNation,
                rng: {},
            } as never,
            {
                gameNow: messageTime,
                messageSharedIconBaseUrl: 'https://ref.example/image/icons',
                actionArgs: { destGeneralId: destination.id },
                worldRef: { getGeneralById: () => destination },
                scenarioConfig: { const: {} },
            } as never
        );
        expect(builtContext).toMatchObject({ messageTime });

        const result = new ActionResolver().resolve(
            {
                general,
                nation: sourceNation,
                destGeneral: destination,
                messageTime,
                env: { develCost: 100 },
                worldView: { listNations: () => [sourceNation, destinationNation] },
                addLog: (text: string, options: unknown) => logs.push({ text, options }),
            } as never,
            { destGeneralId: destination.id }
        );

        expect(result.effects).toContainEqual({
            type: 'message:add',
            draft: {
                msgType: 'private',
                src: {
                    generalId: general.id,
                    generalName: general.name,
                    nationId: sourceNation.id,
                    nationName: sourceNation.name,
                    color: sourceNation.color,
                    icon: 'https://sam-image.hided.net/icons/default.jpg',
                },
                dest: {
                    generalId: destination.id,
                    generalName: destination.name,
                    nationId: destinationNation.id,
                    nationName: destinationNation.name,
                    color: destinationNation.color,
                    icon: 'https://sam-image.hided.net/icons/default.jpg',
                },
                text: '위로 망명 권유 서신',
                time: messageTime,
                validUntil: new Date('9999-12-31T12:59:59.000Z'),
                option: { action: 'scout' },
                sendDestOnly: true,
            },
        });
        expect(result.effects.filter((effect) => effect.type === 'log')).toEqual([]);
        expect(logs).toHaveLength(1);
    });
});
