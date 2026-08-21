import { describe, expect, it } from 'vitest';

import { createRefOrderedActionStack } from '../src/actionModules/bundle.js';
import type { GeneralActionModule } from '../src/actionModules/general.js';
import { ActionDefinition } from '../src/actions/turn/general/che_소집해제.js';
import { traitModule as recruitTrait } from '../src/actionModules/traits/war/che_징병.js';

describe('che_소집해제', () => {
    it('applies legacy experience and dedication stat hooks', () => {
        const personality = {
            eventHandlers: {},
            onCalcStat: (_context, statName, value) => {
                if (statName === 'experience') return Number(value) * 1.1;
                if (statName === 'dedication') return Number(value) * 0.9;
                return value;
            },
        } satisfies GeneralActionModule;
        const noOp = {};
        const definition = new ActionDefinition({
            generalActionModules: createRefOrderedActionStack({
                nation: noOp,
                officer: noOp,
                domestic: noOp,
                war: noOp,
                personality,
                crewType: null,
                inheritance: noOp,
                scenario: null,
                items: [],
            }),
        } as never);
        const general = { crew: 500, experience: 1_000, dedication: 2_000 };
        const city = { population: 10_000 };

        definition.resolve(
            {
                general,
                city,
                addLog: () => undefined,
            } as never,
            {}
        );

        expect(general.experience).toBe(1_077);
        expect(general.dedication).toBe(2_090);
    });

    it('does not return population when the general has the 징병 trait', () => {
        const definition = new ActionDefinition({
            generalActionModules: [recruitTrait],
        } as never);
        const general = {
            crew: 500,
            experience: 1_000,
            dedication: 2_000,
            stats: { leadership: 80, strength: 70, intelligence: 60 },
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: 'che_징병',
                items: { horse: null, weapon: null, book: null, item: null },
            },
            meta: {},
        };
        const city = { population: 10_000 };

        definition.resolve(
            {
                general,
                city,
                addLog: () => undefined,
            } as never,
            {}
        );

        expect(general.crew).toBe(0);
        expect(city.population).toBe(10_000);
    });
});
