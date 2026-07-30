import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';
import type { WarActionModule } from '@sammo-ts/logic/war/actions.js';
import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_전멸시페이즈증가 } from '@sammo-ts/logic/war/triggers/che_전멸시페이즈증가.js';
import { WarUnitCity } from '@sammo-ts/logic/war/units.js';
import { normalizeScenarioEffect } from '@sammo-ts/logic/scenario/scenarioEffect.js';

export type { ScenarioEffectKey } from '@sammo-ts/logic/scenario/scenarioEffect.js';

export interface ScenarioEffectActionModules<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    general: GeneralActionModule<TriggerState> | null;
    war: WarActionModule<TriggerState> | null;
}

const MORE_EFFECT_DOMESTIC_ACTIONS = new Set(['상업', '농업', '치안', '기술', '성벽', '수비', '인구', '민심']);

const createDefenceThresholdGeneralModule = <
    TriggerState extends GeneralTriggerState,
>(): GeneralActionModule<TriggerState> => ({
    onCalcDomestic: (_context, turnType, _varType, value) => (turnType === 'changeDefenceTrain' ? 0 : value),
});

const createAdvanceTriggerWarModule = <TriggerState extends GeneralTriggerState>(
    includeCityWarPower: boolean
): WarActionModule<TriggerState> => ({
    getWarPowerMultiplier: (_context, unit, oppose) => {
        if (!includeCityWarPower && (unit instanceof WarUnitCity || oppose instanceof WarUnitCity)) {
            return [1, 1];
        }
        return unit.isAttacker() ? [1.4, 0.7143] : [1, 1];
    },
    getBattlePhaseTriggerList: (context) => {
        const unit = context.unit;
        return unit ? new WarTriggerCaller(new che_전멸시페이즈증가(unit)) : null;
    },
});

const createMoreEffectGeneralModule = <
    TriggerState extends GeneralTriggerState,
>(): GeneralActionModule<TriggerState> => ({
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === 'changeDefenceTrain') {
            return 0;
        }
        return varType === 'score' && MORE_EFFECT_DOMESTIC_ACTIONS.has(turnType) ? value * 2 : value;
    },
    // ref에도 정의되어 있지만 실제 월간 수입 경로는 General이 아니라
    // nation type module만 호출합니다. protocol 보존용이며 월간 경로에는
    // 이 general hook을 연결하지 않습니다.
    onCalcNationalIncome: (_context, type, amount) => {
        if (type === 'gold' || type === 'rice' || (type === 'pop' && amount > 0)) {
            return amount * 2;
        }
        return amount;
    },
});

export const createScenarioEffectActionModules = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    scenarioEffect?: string | null
): ScenarioEffectActionModules<TriggerState> => {
    const normalizedEffect = normalizeScenarioEffect(scenarioEffect);
    if (!normalizedEffect) {
        return { general: null, war: null };
    }

    switch (normalizedEffect) {
        case 'event_UnlimitedDefenceThresholdChange':
            return {
                general: createDefenceThresholdGeneralModule<TriggerState>(),
                war: null,
            };
        case 'event_StrongAttacker':
            return {
                general: createDefenceThresholdGeneralModule<TriggerState>(),
                war: createAdvanceTriggerWarModule<TriggerState>(false),
            };
        case 'event_MoreEffect':
            return {
                general: createMoreEffectGeneralModule<TriggerState>(),
                war: createAdvanceTriggerWarModule<TriggerState>(true),
            };
    }
};
