export const SCENARIO_EFFECT_KEYS = [
    'event_UnlimitedDefenceThresholdChange',
    'event_StrongAttacker',
    'event_MoreEffect',
] as const;

export type ScenarioEffectKey = (typeof SCENARIO_EFFECT_KEYS)[number];

const DEFENCE_TRAIN_PENALTY_WAIVER_EFFECTS = new Set<ScenarioEffectKey>([
    'event_UnlimitedDefenceThresholdChange',
    'event_StrongAttacker',
    'event_MoreEffect',
]);

export const isScenarioEffectKey = (value: string): value is ScenarioEffectKey =>
    SCENARIO_EFFECT_KEYS.includes(value as ScenarioEffectKey);

export const normalizeScenarioEffect = (value: unknown): ScenarioEffectKey | null => {
    if (value === undefined || value === null || value === '' || value === 'None') {
        return null;
    }
    if (typeof value === 'string' && isScenarioEffectKey(value)) {
        return value;
    }
    throw new Error(`Unknown scenario effect: ${String(value)}`);
};

export const isDefenceTrainPenaltyWaivedByScenarioEffect = (value: string | null | undefined): boolean => {
    const effect = normalizeScenarioEffect(value);
    return effect !== null && DEFENCE_TRAIN_PENALTY_WAIVER_EFFECTS.has(effect);
};
