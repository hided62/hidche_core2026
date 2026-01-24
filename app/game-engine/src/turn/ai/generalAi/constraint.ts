import type { ScenarioMeta, TurnCommandEnv } from '@sammo-ts/logic';

import type { TurnWorldState } from '../../types.js';

export type ConstraintEnv = Record<string, unknown>;

export const resolveConstraintEnv = (
    world: TurnWorldState,
    scenarioMeta: ScenarioMeta | undefined,
    env: TurnCommandEnv
): ConstraintEnv => {
    const startYear = typeof scenarioMeta?.startYear === 'number' ? scenarioMeta.startYear : undefined;
    const relYear = typeof startYear === 'number' ? world.currentYear - startYear : undefined;

    return {
        currentYear: world.currentYear,
        currentMonth: world.currentMonth,
        year: world.currentYear,
        month: world.currentMonth,
        startYear,
        relYear,
        openingPartYear: env.openingPartYear,
        minAvailableRecruitPop: env.minAvailableRecruitPop,
    };
};
