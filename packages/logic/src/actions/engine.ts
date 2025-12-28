import type { RandomGenerator } from '@sammo-ts/common';
import type {
    City,
    General,
    GeneralRole,
    GeneralTriggerState,
    Nation,
    StatBlock,
} from '../domain/entities.js';
import type { GeneralActionContext } from '../triggers/general.js';
import { getNextTurnAt, type TurnSchedule } from '../turn/calendar.js';

export interface GeneralActionResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> extends GeneralActionContext<TriggerState> {
    rng: RandomGenerator;
    city?: City;
    nation?: Nation | null;
}

export interface TurnScheduleContext {
    now: Date;
    schedule: TurnSchedule;
}

export interface GeneralPatchEffect {
    type: 'general:patch';
    patch: Partial<General>;
}

export interface CityPatchEffect {
    type: 'city:patch';
    patch: Partial<City>;
}

export interface NationPatchEffect {
    type: 'nation:patch';
    patch: Partial<Nation>;
}

export interface LogEffect {
    type: 'log';
    message: string;
}

export interface NextTurnOverrideEffect {
    type: 'schedule:override';
    nextTurnAt: Date;
}

export type GeneralActionEffect =
    | GeneralPatchEffect
    | CityPatchEffect
    | NationPatchEffect
    | LogEffect
    | NextTurnOverrideEffect;

export interface GeneralActionOutcome {
    effects: GeneralActionEffect[];
}

export interface GeneralActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    key: string;
    resolve(context: GeneralActionResolveContext<TriggerState>): GeneralActionOutcome;
}

export interface GeneralActionResolution {
    general: General;
    city?: City;
    nation?: Nation | null;
    nextTurnAt: Date;
    logs: string[];
    effects: GeneralActionEffect[];
}

const mergeStats = (base: StatBlock, patch: Partial<StatBlock>): StatBlock => ({
    leadership: patch.leadership ?? base.leadership,
    strength: patch.strength ?? base.strength,
    intelligence: patch.intelligence ?? base.intelligence,
});

const mergeRole = (
    base: GeneralRole,
    patch: Partial<GeneralRole>
): GeneralRole => ({
    ...base,
    ...patch,
    items: {
        ...base.items,
        ...(patch.items ?? {}),
    },
});

const mergeTriggerState = (
    base: GeneralTriggerState,
    patch: Partial<GeneralTriggerState>
): GeneralTriggerState => ({
    ...base,
    ...patch,
    flags: { ...base.flags, ...(patch.flags ?? {}) },
    counters: { ...base.counters, ...(patch.counters ?? {}) },
    modifiers: { ...base.modifiers, ...(patch.modifiers ?? {}) },
    meta: { ...base.meta, ...(patch.meta ?? {}) },
});

const applyGeneralPatch = (base: General, patch: Partial<General>): General => ({
    ...base,
    ...patch,
    stats: patch.stats ? mergeStats(base.stats, patch.stats) : base.stats,
    role: patch.role ? mergeRole(base.role, patch.role) : base.role,
    triggerState: patch.triggerState
        ? mergeTriggerState(base.triggerState, patch.triggerState)
        : base.triggerState,
    meta: patch.meta ? { ...base.meta, ...patch.meta } : base.meta,
});

const applyCityPatch = (base: City, patch: Partial<City>): City => ({
    ...base,
    ...patch,
    meta: patch.meta ? { ...base.meta, ...patch.meta } : base.meta,
});

const applyNationPatch = (base: Nation, patch: Partial<Nation>): Nation => ({
    ...base,
    ...patch,
    meta: patch.meta ? { ...base.meta, ...patch.meta } : base.meta,
});

// 행동 결과를 Effect로 모아 상태/턴 계산을 수행한다.
export const resolveGeneralAction = <
    TriggerState extends GeneralTriggerState = GeneralTriggerState
>(
    resolver: GeneralActionResolver<TriggerState>,
    context: GeneralActionResolveContext<TriggerState>,
    scheduleContext: TurnScheduleContext
): GeneralActionResolution => {
    const outcome = resolver.resolve(context);
    const logs: string[] = [];
    let nextGeneral = context.general;
    let nextCity = context.city;
    let nextNation = context.nation ?? null;
    let nextTurnAtOverride: Date | null = null;

    for (const effect of outcome.effects) {
        switch (effect.type) {
            case 'general:patch':
                nextGeneral = applyGeneralPatch(nextGeneral, effect.patch);
                break;
            case 'city:patch':
                if (nextCity) {
                    nextCity = applyCityPatch(nextCity, effect.patch);
                }
                break;
            case 'nation:patch':
                if (nextNation) {
                    nextNation = applyNationPatch(nextNation, effect.patch);
                }
                break;
            case 'log':
                logs.push(effect.message);
                break;
            case 'schedule:override':
                nextTurnAtOverride = effect.nextTurnAt;
                break;
            default:
                break;
        }
    }

    const nextTurnAt =
        nextTurnAtOverride ??
        getNextTurnAt(scheduleContext.now, scheduleContext.schedule);

    return {
        general: nextGeneral,
        city: nextCity,
        nation: nextNation,
        nextTurnAt,
        logs,
        effects: outcome.effects,
    };
};
