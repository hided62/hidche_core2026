import { describe, expect, it } from 'vitest';
import type { City, CitySeed } from '@sammo-ts/logic';

import { applyChangeCity, applyInitialChangeCityEvents } from '../src/turn/monthlyChangeCityAction.js';

const buildCity = (id: number, nationId: number, name = `도시${id}`): City => ({
    id,
    name,
    nationId,
    level: 4,
    state: 0,
    population: 1_001,
    populationMax: 2_000,
    agriculture: 501,
    agricultureMax: 1_000,
    commerce: 499,
    commerceMax: 1_000,
    security: 99,
    securityMax: 1_000,
    supplyState: 1,
    frontState: 0,
    defence: 101,
    defenceMax: 1_000,
    wall: 50,
    wallMax: 1_000,
    meta: { trust: 40, trade: 100 },
});

describe('ChangeCity monthly action', () => {
    it('applies legacy target selection, percentage rounding, clamping, and ordered max changes', () => {
        const cities = [buildCity(1, 0, '낙양'), buildCity(2, 1, '장안')];

        expect(applyChangeCity(cities, 'free', { pop: '50%', trust: '+70', trade: 999 })).toEqual([
            expect.objectContaining({
                id: 1,
                population: 1_000,
                meta: expect.objectContaining({ trust: 100, trade: 105 }),
            }),
        ]);
        expect(applyChangeCity(cities, 'occupied', { agri: '*2', comm: '-600' })).toEqual([
            expect.objectContaining({ id: 2, agriculture: 1_000, commerce: 0 }),
        ]);
        expect(
            applyChangeCity(cities, ['cities', 1, '장안'], {
                pop_max: '+100',
                pop: '100%',
            })
        ).toEqual([
            expect.objectContaining({ id: 2, populationMax: 2_100, population: 2_100 }),
        ]);
    });

    it('applies unconditional scenario initial events without changing non-target cities', () => {
        const cities = [
            { ...buildCity(1, 0), trust: 40, trade: 100 },
            { ...buildCity(2, 1), trust: 40, trade: 100 },
        ] as CitySeed[];

        const result = applyInitialChangeCityEvents(cities, [
            [
                true,
                ['ChangeCity', 'free', { pop: '70%', trust: 80 }],
                ['ChangeCity', 'occupied', { def: '70%', wall: '70%' }],
            ],
        ]);

        expect(result[0]).toMatchObject({ population: 1_400, trust: 80, defence: 101, wall: 50 });
        expect(result[1]).toMatchObject({ population: 1_001, trust: 40, defence: 700, wall: 700 });
    });

    it('rejects invalid fields and division by zero', () => {
        expect(() => applyChangeCity([buildCity(1, 0)], 'all', { unknown: 1 })).toThrow(
            'Unsupported ChangeCity key'
        );
        expect(() => applyChangeCity([buildCity(1, 0)], 'all', { pop: '/0' })).toThrow(
            'divide by zero'
        );
    });
});
