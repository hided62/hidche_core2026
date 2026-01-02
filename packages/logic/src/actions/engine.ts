import type { RandomGenerator } from '@sammo-ts/common';
import { enablePatches, produceWithPatches, type Draft, castDraft } from 'immer';
import type {
    City,
    General,
    GeneralTriggerState,
    CityId,
    GeneralId,
    Nation,
    NationId,
} from '../domain/entities.js';
import type { GeneralActionContext } from '../triggers/general.js';
import { getNextTurnAt, type TurnSchedule } from '../turn/calendar.js';
import {
    LogCategory,
    type LogEntryDraft,
    LogFormat,
    LogScope,
} from '../logging/types.js';

enablePatches();

export interface WorldState<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    general: General<TriggerState>;
    city?: City;
    nation?: Nation | null;
}

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
    targetId?: GeneralId;
}

export interface GeneralAddEffect<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    type: 'general:add';
    general: General<TriggerState>;
}

export interface CityPatchEffect {
    type: 'city:patch';
    patch: Partial<City>;
    targetId?: CityId;
}

export interface NationPatchEffect {
    type: 'nation:patch';
    patch: Partial<Nation>;
    targetId?: NationId;
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
    | GeneralAddEffect<TriggerState>
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
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
    Args = unknown
> {
    key: string;
    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: Args
    ): GeneralActionOutcome<TriggerState>;
}

export interface GeneralActionResolution {
    general: General;
    city?: City;
    nation?: Nation | null;
    nextTurnAt: Date;
    logs: LogEntryDraft[];
    effects: GeneralActionEffect[];
    created?: {
        generals: General[];
    };
    patches?: {
        generals: Array<{ id: GeneralId; patch: Partial<General> }>;
        cities: Array<{ id: CityId; patch: Partial<City> }>;
        nations: Array<{ id: NationId; patch: Partial<Nation> }>;
    };
    dirty?: {
        general: boolean;
        city: boolean;
        nation: boolean;
        generalId?: GeneralId;
        cityId?: CityId;
        nationId?: NationId;
    };
}

/**
 * Immer Draft에 Effect를 적용한다.
 * 기존 Effect 기반 코드를 유지하면서 Draft에 즉시 반영하기 위함.
 */
export const applyEffectToDraft = <
    TriggerState extends GeneralTriggerState = GeneralTriggerState
>(
    draft: Draft<WorldState<TriggerState>>,
    effect: GeneralActionEffect<TriggerState>,
    context: { generalId: GeneralId; cityId?: CityId; nationId?: NationId }
): void => {
    const generalDraft = draft.general as any;
    switch (effect.type) {
        case 'general:patch':
            if (
                effect.targetId === undefined ||
                effect.targetId === context.generalId
            ) {
                Object.assign(generalDraft, effect.patch);
                if (effect.patch.stats) {
                    generalDraft.stats = {
                        ...generalDraft.stats,
                        ...effect.patch.stats,
                    };
                }
                if (effect.patch.role) {
                    generalDraft.role = {
                        ...generalDraft.role,
                        ...effect.patch.role,
                        items: {
                            ...generalDraft.role.items,
                            ...(effect.patch.role.items ?? {}),
                        },
                    };
                }
                if (effect.patch.triggerState) {
                    generalDraft.triggerState = {
                        ...generalDraft.triggerState,
                        ...effect.patch.triggerState,
                        flags: {
                            ...generalDraft.triggerState.flags,
                            ...(effect.patch.triggerState.flags ?? {}),
                        },
                        counters: {
                            ...generalDraft.triggerState.counters,
                            ...(effect.patch.triggerState.counters ?? {}),
                        },
                        modifiers: {
                            ...generalDraft.triggerState.modifiers,
                            ...(effect.patch.triggerState.modifiers ?? {}),
                        },
                        meta: {
                            ...generalDraft.triggerState.meta,
                            ...(effect.patch.triggerState.meta ?? {}),
                        },
                    };
                }
                if (effect.patch.meta) {
                    generalDraft.meta = {
                        ...generalDraft.meta,
                        ...effect.patch.meta,
                    };
                }
            }
            break;
        case 'city:patch':
            if (
                draft.city &&
                (effect.targetId === undefined ||
                    effect.targetId === context.cityId)
            ) {
                Object.assign(draft.city, effect.patch);
                if (effect.patch.meta) {
                    draft.city.meta = {
                        ...draft.city.meta,
                        ...effect.patch.meta,
                    };
                }
            }
            break;
        case 'nation:patch':
            if (
                draft.nation &&
                (effect.targetId === undefined ||
                    effect.targetId === context.nationId)
            ) {
                Object.assign(draft.nation, effect.patch);
                if (effect.patch.meta) {
                    draft.nation.meta = {
                        ...draft.nation.meta,
                        ...effect.patch.meta,
                    };
                }
            }
            break;
        default:
            break;
    }
};

export const createGeneralPatchEffect = <
    TriggerState extends GeneralTriggerState = GeneralTriggerState
>(
    patch: Partial<General<TriggerState>>,
    targetId?: GeneralId
): GeneralPatchEffect<TriggerState> => ({
    type: 'general:patch',
    patch,
    ...(targetId !== undefined ? { targetId } : {}),
});

export const createGeneralAddEffect = <
    TriggerState extends GeneralTriggerState = GeneralTriggerState
>(
    general: General<TriggerState>
): GeneralAddEffect<TriggerState> => ({
    type: 'general:add',
    general,
});

export const createCityPatchEffect = (
    patch: Partial<City>,
    targetId?: CityId
): CityPatchEffect => ({
    type: 'city:patch',
    patch,
    ...(targetId !== undefined ? { targetId } : {}),
});

export const createNationPatchEffect = (
    patch: Partial<Nation>,
    targetId?: NationId
): NationPatchEffect => ({
    type: 'nation:patch',
    patch,
    ...(targetId !== undefined ? { targetId } : {}),
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
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
    Args = unknown
>(
    resolver: GeneralActionResolver<TriggerState, Args>,
    context: GeneralActionResolveContext<TriggerState>,
    scheduleContext: TurnScheduleContext,
    args: Args
): GeneralActionResolution => {
    const logs: LogEntryDraft[] = [];
    let nextTurnAtOverride: Date | null = null;
    const createdGenerals: General[] = [];
    const patches: NonNullable<GeneralActionResolution['patches']> = {
        generals: [],
        cities: [],
        nations: [],
    };

    const [nextWorld, worldPatches] = produceWithPatches(
        {
            general: context.general,
            city: context.city,
            nation: context.nation,
        } as WorldState<TriggerState>,
        (draft) => {
            const outcome = resolver.resolve(
                {
                    ...context,
                    general: castDraft(draft.general),
                    city: castDraft(draft.city),
                    nation: castDraft(draft.nation),
                } as GeneralActionResolveContext<TriggerState>,
                args
            );

            for (const effect of outcome.effects) {
                switch (effect.type) {
                    case 'log':
                        // 로그 대상이 비어 있으면 현재 장수/국가 기준으로 보정한다.
                        switch (effect.entry.scope) {
                            case LogScope.GENERAL:
                                logs.push({
                                    ...effect.entry,
                                    generalId:
                                        effect.entry.generalId ??
                                        context.general.id,
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
                    case 'general:add':
                        createdGenerals.push(effect.general as General);
                        break;
                    case 'general:patch':
                    case 'city:patch':
                    case 'nation:patch':
                        applyEffectToDraft(draft, effect, {
                            generalId: context.general.id,
                            ...(context.city?.id !== undefined
                                ? { cityId: context.city.id }
                                : {}),
                            ...(context.nation?.id !== undefined
                                ? { nationId: context.nation.id }
                                : {}),
                        });
                        // 타겟이 다른 경우 patches에 추가 (applyEffectToDraft에서 처리되지 않은 경우)
                        if (
                            effect.type === 'general:patch' &&
                            effect.targetId !== undefined &&
                            effect.targetId !== context.general.id
                        ) {
                            patches.generals.push({
                                id: effect.targetId,
                                patch: effect.patch as Partial<General>,
                            });
                        } else if (
                            effect.type === 'city:patch' &&
                            effect.targetId !== undefined &&
                            effect.targetId !== context.city?.id
                        ) {
                            patches.cities.push({
                                id: effect.targetId,
                                patch: effect.patch,
                            });
                        } else if (
                            effect.type === 'nation:patch' &&
                            effect.targetId !== undefined &&
                            effect.targetId !== context.nation?.id
                        ) {
                            patches.nations.push({
                                id: effect.targetId,
                                patch: effect.patch,
                            });
                        }
                        break;
                }
            }
        }
    );

    const nextTurnAt =
        nextTurnAtOverride ??
        getNextTurnAt(scheduleContext.now, scheduleContext.schedule);

    const dirty: NonNullable<GeneralActionResolution['dirty']> = {
        general: false,
        city: false,
        nation: false,
        generalId: context.general.id,
    };
    if (context.city) dirty.cityId = context.city.id;
    if (context.nation) dirty.nationId = context.nation.id;

    // worldPatches를 분석하여 dirty 설정
    for (const patch of worldPatches) {
        if (patch.path[0] === 'general') dirty.general = true;
        if (patch.path[0] === 'city') dirty.city = true;
        if (patch.path[0] === 'nation') dirty.nation = true;
    }

    const resolution: GeneralActionResolution = {
        general: nextWorld.general as General,
        nation: nextWorld.nation as Nation | null,
        nextTurnAt,
        logs,
        effects: [], // 이제 effects는 직접 사용되지 않음 (이미 반영됨)
    };
    if (nextWorld.city) {
        resolution.city = nextWorld.city as City;
    }
    if (dirty.general || dirty.city || dirty.nation) {
        resolution.dirty = dirty;
    }
    if (
        patches.generals.length > 0 ||
        patches.cities.length > 0 ||
        patches.nations.length > 0
    ) {
        resolution.patches = patches;
    }
    if (createdGenerals.length > 0) {
        resolution.created = {
            generals: createdGenerals,
        };
    }

    return resolution;
};
