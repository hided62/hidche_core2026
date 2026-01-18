import type { TriggerDomesticActionType, TriggerDomesticVarType, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { WarActionModule } from '@sammo-ts/logic/war/actions.js';
import { asRecord, parseJson } from '@sammo-ts/common';

export type InheritBuffType =
    | 'warAvoidRatio'
    | 'warCriticalRatio'
    | 'warMagicTrialProb'
    | 'success'
    | 'fail'
    | 'warAvoidRatioOppose'
    | 'warCriticalRatioOppose'
    | 'warMagicTrialProbOppose';

const DOMESTIC_TARGETS = new Set<TriggerDomesticActionType>([
    '상업',
    '농업',
    '치안',
    '성벽',
    '수비',
    '민심',
    '인구',
    '기술',
]);

const readBuffLevel = (buff: Record<string, unknown>, key: InheritBuffType): number => {
    const raw = buff[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return 0;
    }
    return Math.max(0, Math.min(5, Math.floor(raw)));
};

const parseInheritBuff = (value: unknown): Record<string, unknown> => {
    if (typeof value === 'string') {
        const parsed = parseJson<Record<string, unknown>>(value);
        return parsed ?? {};
    }
    return asRecord(value);
};

const resolveBuffRecord = (context: { general: { meta: Record<string, unknown>; triggerState: { meta: Record<string, unknown> } } }): Record<string, unknown> => {
    const fromTrigger = parseInheritBuff(context.general.triggerState.meta.inheritBuff);
    if (Object.keys(fromTrigger).length > 0) {
        return fromTrigger;
    }
    return parseInheritBuff(context.general.meta.inheritBuff);
};

const applyDomesticBuff = (
    buff: Record<string, unknown>,
    turnType: TriggerDomesticActionType,
    varType: TriggerDomesticVarType,
    value: number
): number => {
    if (!DOMESTIC_TARGETS.has(turnType)) {
        return value;
    }
    if (varType === 'success') {
        const level = readBuffLevel(buff, 'success');
        return value + level * 0.01;
    }
    if (varType === 'fail') {
        const level = readBuffLevel(buff, 'fail');
        return value - level * 0.01;
    }
    return value;
};

const applyWarBuff = (buff: Record<string, unknown>, statName: WarStatName, value: number | [number, number]) => {
    if (typeof value !== 'number') {
        return value;
    }
    if (statName === 'warAvoidRatio') {
        return value + readBuffLevel(buff, 'warAvoidRatio') * 0.01;
    }
    if (statName === 'warCriticalRatio') {
        return value + readBuffLevel(buff, 'warCriticalRatio') * 0.01;
    }
    if (statName === 'warMagicTrialProb') {
        return value + readBuffLevel(buff, 'warMagicTrialProb') * 0.01;
    }
    return value;
};

const applyOpposeWarBuff = (
    buff: Record<string, unknown>,
    statName: WarStatName,
    value: number | [number, number]
) => {
    if (typeof value !== 'number') {
        return value;
    }
    if (statName === 'warAvoidRatio') {
        return value - readBuffLevel(buff, 'warAvoidRatioOppose') * 0.01;
    }
    if (statName === 'warCriticalRatio') {
        return value - readBuffLevel(buff, 'warCriticalRatioOppose') * 0.01;
    }
    if (statName === 'warMagicTrialProb') {
        return value - readBuffLevel(buff, 'warMagicTrialProbOppose') * 0.01;
    }
    return value;
};

export const createInheritBuffModules = (): { general: GeneralActionModule; war: WarActionModule } => {
    const general: GeneralActionModule = {
        onCalcDomestic: (context, turnType, varType, value) =>
            applyDomesticBuff(resolveBuffRecord(context), turnType, varType, value),
    };

    const war: WarActionModule = {
        onCalcStat: (context, statName, value) => applyWarBuff(resolveBuffRecord(context), statName, value),
        onCalcOpposeStat: (context, statName, value) => applyOpposeWarBuff(resolveBuffRecord(context), statName, value),
    };

    return { general, war };
};
