import type { RandomGenerator } from '@sammo-ts/common';
import type {
    City,
    General,
    GeneralRole,
    GeneralTriggerState,
    CityId,
    GeneralId,
    Nation,
    NationId,
    StatBlock,
} from '../domain/entities.js';
import type { GeneralActionContext } from '../triggers/general.js';
import { getNextTurnAt, type TurnSchedule } from '../turn/calendar.js';
import {
    LogCategory,
    type LogEntryDraft,
    LogFormat,
    LogScope,
} from '../logging/types.js';

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

export interface GeneralPatchEffect<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    type: 'general:patch';
    patch: Partial<General<TriggerState>>;
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
    entry: LogEntryDraft;
}

export interface NextTurnOverrideEffect {
    type: 'schedule:override';
    nextTurnAt: Date;
}

export type GeneralActionEffect<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> =
    | GeneralPatchEffect<TriggerState>
    | CityPatchEffect
    | NationPatchEffect
    | LogEffect
    | NextTurnOverrideEffect;

export interface GeneralActionOutcome<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    effects: GeneralActionEffect<TriggerState>[];
}

export interface GeneralActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    key: string;
    resolve(
        context: GeneralActionResolveContext<TriggerState>
    ): GeneralActionOutcome<TriggerState>;
}

export interface GeneralActionResolution {
    general: General;
    city?: City;
    nation?: Nation | null;
    nextTurnAt: Date;
    logs: LogEntryDraft[];
    effects: GeneralActionEffect[];
    dirty?: {
        general: boolean;
        city: boolean;
        nation: boolean;
        generalId?: GeneralId;
        cityId?: CityId;
        nationId?: NationId;
    };
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

const mergeTriggerState = <TriggerState extends GeneralTriggerState>(
    base: TriggerState,
    patch: Partial<TriggerState>
): TriggerState => ({
    ...base,
    ...patch,
    flags: { ...base.flags, ...(patch.flags ?? {}) },
    counters: { ...base.counters, ...(patch.counters ?? {}) },
    modifiers: { ...base.modifiers, ...(patch.modifiers ?? {}) },
    meta: { ...base.meta, ...(patch.meta ?? {}) },
});

const applyGeneralPatch = <TriggerState extends GeneralTriggerState>(
    base: General<TriggerState>,
    patch: Partial<General<TriggerState>>
): General<TriggerState> => ({
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

export const createGeneralPatchEffect = <
    TriggerState extends GeneralTriggerState = GeneralTriggerState
>(
    patch: Partial<General<TriggerState>>
): GeneralPatchEffect<TriggerState> => ({
    type: 'general:patch',
    patch,
});

export const createCityPatchEffect = (patch: Partial<City>): CityPatchEffect => ({
    type: 'city:patch',
    patch,
});

export const createNationPatchEffect = (
    patch: Partial<Nation>
): NationPatchEffect => ({
    type: 'nation:patch',
    patch,
});

export const createLogEffect = (
    message: string,
    options: Partial<Omit<LogEntryDraft, 'text'>> = {}
): LogEffect => ({
    type: 'log',
    entry: {
        scope: options.scope ?? LogScope.GENERAL,
        category: options.category ?? LogCategory.ACTION,
        text: message,
        ...(options.generalId !== undefined
            ? { generalId: options.generalId }
            : {}),
        ...(options.nationId !== undefined
            ? { nationId: options.nationId }
            : {}),
        ...(options.userId !== undefined ? { userId: options.userId } : {}),
        ...(options.subType !== undefined ? { subType: options.subType } : {}),
        ...(options.meta !== undefined ? { meta: options.meta } : {}),
        format: options.format ?? LogFormat.MONTH,
    },
});

export const createNextTurnOverrideEffect = (
    nextTurnAt: Date
): NextTurnOverrideEffect => ({
    type: 'schedule:override',
    nextTurnAt,
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
    const logs: LogEntryDraft[] = [];
    let nextGeneral = context.general;
    let nextCity = context.city;
    let nextNation = context.nation ?? null;
    let nextTurnAtOverride: Date | null = null;
    const dirty: NonNullable<GeneralActionResolution['dirty']> = {
        general: false,
        city: false,
        nation: false,
        generalId: context.general.id,
    };
    if (context.city) {
        dirty.cityId = context.city.id;
    }
    if (context.nation) {
        dirty.nationId = context.nation.id;
    }

    for (const effect of outcome.effects) {
        switch (effect.type) {
            case 'general:patch':
                nextGeneral = applyGeneralPatch(nextGeneral, effect.patch);
                dirty.general = true;
                break;
            case 'city:patch':
                if (nextCity) {
                    nextCity = applyCityPatch(nextCity, effect.patch);
                    dirty.city = true;
                }
                break;
            case 'nation:patch':
                if (nextNation) {
                    nextNation = applyNationPatch(nextNation, effect.patch);
                    dirty.nation = true;
                }
                break;
            case 'log':
                // 로그 대상이 비어 있으면 현재 장수/국가 기준으로 보정한다.
                switch (effect.entry.scope) {
                    case LogScope.GENERAL:
                        logs.push({
                            ...effect.entry,
                            generalId:
                                effect.entry.generalId ?? context.general.id,
                        });
                        break;
                    case LogScope.NATION:
                        if (effect.entry.nationId !== undefined) {
                            logs.push(effect.entry);
                            break;
                        }
                        if (context.nation?.id !== undefined) {
                            logs.push({
                                ...effect.entry,
                                nationId: context.nation.id,
                            });
                        }
                        break;
                    case LogScope.USER:
                        if (effect.entry.userId) {
                            logs.push(effect.entry);
                        }
                        break;
                    case LogScope.SYSTEM:
                    default:
                        logs.push(effect.entry);
                        break;
                }
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

    const resolution: GeneralActionResolution = {
        general: nextGeneral,
        nation: nextNation,
        nextTurnAt,
        logs,
        effects: outcome.effects,
    };
    if (nextCity) {
        resolution.city = nextCity;
    }
    if (dirty.general || dirty.city || dirty.nation) {
        resolution.dirty = dirty;
    }

    return resolution;
};
