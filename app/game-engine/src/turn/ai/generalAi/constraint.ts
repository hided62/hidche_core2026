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
    const worldMeta = world.meta as Record<string, unknown>;
    const rawKillturn = worldMeta.killturn;
    const killturn =
        typeof rawKillturn === 'number'
            ? rawKillturn
            : typeof rawKillturn === 'string'
              ? Number(rawKillturn)
              : undefined;

    return {
        currentYear: world.currentYear,
        currentMonth: world.currentMonth,
        year: world.currentYear,
        month: world.currentMonth,
        startYear,
        relYear,
        // Ref asks each concrete command for its full constraints while the AI
        // is still choosing a command. Cost-bearing commands therefore need
        // the current yearly game_env.develcost at this boundary as well.
        develCost: env.develCost,
        openingPartYear: env.openingPartYear,
        minAvailableRecruitPop: env.minAvailableRecruitPop,
        maxTechLevel: env.maxTechLevel,
        ...(Number.isFinite(killturn) ? { killturn } : {}),
    };
};
