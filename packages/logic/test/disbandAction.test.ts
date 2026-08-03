import { describe, expect, it } from 'vitest';

import { createRefOrderedActionStack } from '../src/actionModules/bundle.js';
import type { GeneralActionModule } from '../src/actionModules/general.js';
import { ActionDefinition } from '../src/actions/turn/general/che_소집해제.js';

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
});
