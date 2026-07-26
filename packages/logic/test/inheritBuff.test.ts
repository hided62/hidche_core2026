import { describe, expect, it } from 'vitest';

import type { General } from '../src/domain/entities.js';
import { createInheritBuffModules } from '../src/inheritance/inheritBuff.js';
import { GeneralActionPipeline } from '../src/triggers/general-action.js';

const buildGeneral = (inheritBuff: Record<string, number>): General => ({
    id: 1,
    name: 'Tester',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 60, intelligence: 50 },
    experience: 0,
    dedication: 0,
    officerLevel: 0,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 0,
    rice: 0,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 20,
    npcState: 0,
    triggerState: {
        flags: {},
        counters: {},
        modifiers: {},
        meta: {},
    },
    meta: { killturn: 24, inheritBuff: JSON.stringify(inheritBuff) },
});

describe('inheritance buff legacy keys', () => {
    it('applies the canonical legacy domestic buff names', () => {
        const pipeline = new GeneralActionPipeline([createInheritBuffModules().general]);
        const context = {
            general: buildGeneral({
                domesticSuccessProb: 3,
                domesticFailProb: 2,
            }),
        };

        expect(pipeline.onCalcDomestic(context, '농업', 'success', 0.5)).toBeCloseTo(0.53);
        expect(pipeline.onCalcDomestic(context, '상업', 'fail', 0.2)).toBeCloseTo(0.18);
    });

    it('continues to read the earlier core success and fail aliases', () => {
        const pipeline = new GeneralActionPipeline([createInheritBuffModules().general]);
        const context = {
            general: buildGeneral({
                success: 2,
                fail: 1,
            }),
        };

        expect(pipeline.onCalcDomestic(context, '치안', 'success', 0.5)).toBeCloseTo(0.52);
        expect(pipeline.onCalcDomestic(context, '성벽', 'fail', 0.2)).toBeCloseTo(0.19);
    });
});
