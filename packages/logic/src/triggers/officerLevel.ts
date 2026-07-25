import { asRecord } from '@sammo-ts/common';
import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionModule } from './general-action.js';
import type { WarActionContext, WarActionModule } from '@sammo-ts/logic/war/actions.js';

const resolveOfficerLevel = (context: {
    general: { officerLevel: number; cityId: number; meta: Record<string, unknown> };
}): number => {
    const level = context.general.officerLevel;
    if (level < 2 || level > 4) {
        return level;
    }
    const meta = asRecord(context.general.meta);
    const officerCity = meta.officerCity ?? meta.officer_city;
    return officerCity === context.general.cityId ? level : 1;
};

const resolveLeadershipBonus = (officerLevel: number, nationLevel: number): number => {
    if (officerLevel === 12) {
        return nationLevel * 2;
    }
    return officerLevel >= 5 ? nationLevel : 0;
};

const officerGeneralModule: GeneralActionModule = {
    onCalcDomestic: (context, turnType, varType, value) => {
        if (varType !== 'score') {
            return value;
        }
        const level = resolveOfficerLevel(context);
        if (
            ((turnType === '농업' || turnType === '상업') && [12, 11, 9, 7, 5, 3].includes(level)) ||
            (turnType === '기술' && [12, 11, 9, 7, 5].includes(level)) ||
            ((turnType === '민심' || turnType === '인구') && [12, 11, 2].includes(level)) ||
            ((turnType === '수비' || turnType === '성벽' || turnType === '치안') &&
                [12, 11, 10, 8, 6, 4].includes(level))
        ) {
            return value * 1.05;
        }
        return value;
    },
    onCalcStat: (context, statName, value) => {
        if (statName !== 'leadership') {
            return value;
        }
        return value + resolveLeadershipBonus(resolveOfficerLevel(context), context.nation?.level ?? 0);
    },
};

const officerWarModule: WarActionModule = {
    onCalcStat: (context: WarActionContext, statName, value) => {
        if (statName !== 'leadership' || typeof value !== 'number') {
            return value;
        }
        return value + resolveLeadershipBonus(resolveOfficerLevel(context), context.nation?.level ?? 0);
    },
    getWarPowerMultiplier: (context: WarActionContext) => {
        const level = resolveOfficerLevel(context);
        if (level === 12) return [1.07, 0.93];
        if (level === 11) return [1.05, 0.95];
        if ([10, 8, 6].includes(level)) return [1.1, 1];
        if ([9, 7, 5].includes(level)) return [1, 0.9];
        if ([4, 3, 2].includes(level)) return [1.05, 0.95];
        return [1, 1];
    },
};

export const createOfficerLevelActionModules = <
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
>(): {
    general: GeneralActionModule<TriggerState>;
    war: WarActionModule<TriggerState>;
} => ({
    general: officerGeneralModule as GeneralActionModule<TriggerState>,
    war: officerWarModule as WarActionModule<TriggerState>,
});
