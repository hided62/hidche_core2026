import { asNumber, asRecord } from '@sammo-ts/common';
import {
    CENTENNIAL_ALL_STAR_DEFAULT_DEX_LIMIT,
    CENTENNIAL_ALL_STAR_NPC_PROGRESS_MULTIPLIER,
    CENTENNIAL_ALL_STAR_POOL,
    LogCategory,
    LogFormat,
    LogScope,
    applyCentennialAllStarTarget,
    readCentennialAllStarAux,
    type CentennialAllStarRules,
} from '@sammo-ts/logic';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler } from './monthlyEventHandler.js';

const resolveRules = (world: InMemoryTurnWorld): CentennialAllStarRules => {
    const scenario = world.getScenarioConfig();
    const configConst = asRecord(scenario.const);
    return {
        defaultStatMin: scenario.stat.min,
        defaultStatMax: scenario.stat.max,
        defaultStatTotal: scenario.stat.total,
        maxStatLevel: asNumber(configConst.maxLevel, 255),
        defaultSpecialDomestic:
            typeof configConst.defaultSpecialDomestic === 'string' ? configConst.defaultSpecialDomestic : 'None',
        dexLimit: asNumber(configConst.dexLimit, CENTENNIAL_ALL_STAR_DEFAULT_DEX_LIMIT),
    };
};

const resolveNpcDexTargetRatio = (world: InMemoryTurnWorld): number => {
    const value = asNumber(asRecord(world.getScenarioConfig().map).centennialNpcDexTargetRatio, 0.4);
    if (value < 0 || value > 1) {
        throw new Error('centennialNpcDexTargetRatio must be between 0 and 1');
    }
    return value;
};

export const createAdvanceCentennialAllStarHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): MonthlyEventActionHandler => {
    return (_args, environment) => {
        const world = options.getWorld();
        if (!world || asRecord(world.getScenarioConfig().map).targetGeneralPool !== CENTENNIAL_ALL_STAR_POOL) {
            return;
        }
        const rules = resolveRules(world);
        const npcDexTargetRatio = resolveNpcDexTargetRatio(world);
        for (const general of world.listGenerals()) {
            const aux = readCentennialAllStarAux(general.meta as Record<string, unknown>);
            if (!aux) {
                continue;
            }
            const isGeneratedNpc = general.npcState === 3 || general.npcState === 4;
            const result = applyCentennialAllStarTarget(
                general,
                aux.target,
                {
                    startYear: environment.startyear,
                    year: environment.year,
                    month: environment.month,
                },
                rules,
                isGeneratedNpc ? CENTENNIAL_ALL_STAR_NPC_PROGRESS_MULTIPLIER : 1,
                isGeneratedNpc ? npcDexTargetRatio : 1
            );
            // progressMonth 같은 aux 필드도 월마다 영속화해야 하므로 실제 수치
            // 변화가 없는 경우에도 Ref General::applyDB()와 같이 dirty 처리한다.
            world.updateGeneral(general.id, {
                stats: result.stats,
                role: result.role,
                meta: result.meta,
            });
            if (result.milestone <= result.previousMilestone) {
                continue;
            }
            const percent = result.milestone * 20;
            world.pushLog({
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: general.id,
                text: `<L>올스타 동조율</>이 <C>${percent}%</>에 도달했습니다!`,
                format: LogFormat.PLAIN,
                year: environment.year,
                month: environment.month,
            });
            world.pushLog({
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                generalId: general.id,
                text: `<L>올스타 동조율 ${percent}% 달성</>`,
                format: LogFormat.YEAR_MONTH,
                year: environment.year,
                month: environment.month,
            });
        }
    };
};
