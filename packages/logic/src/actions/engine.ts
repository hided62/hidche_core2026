import type { RandomGenerator } from '@sammo-ts/common';
import { enablePatches, produceWithPatches, castDraft } from 'immer';
import type {
    City,
    General,
    GeneralTriggerState,
    CityId,
    GeneralId,
    Nation,
    NationId,
} from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import { getNextTurnAt, type TurnSchedule } from '@sammo-ts/logic/turn/calendar.js';
import { LogCategory, type LogEntryDraft, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';

enablePatches();

export interface WorldState<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    general: General<TriggerState>;
    city?: City;
    nation?: Nation | null;
}

export interface GeneralActionResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionContext<TriggerState> {
    rng: RandomGenerator;
    city?: City;
    nation?: Nation | null;
    addLog(message: string, options?: Partial<Omit<LogEntryDraft, 'text'>>): void;
}

export type GeneralActionResolveInputContext<TriggerState extends GeneralTriggerState = GeneralTriggerState> = Omit<
    GeneralActionResolveContext<TriggerState>,
    'addLog'
>;

export interface TurnScheduleContext {
    now: Date;
    schedule: TurnSchedule;
}

export interface GeneralPatchEffect<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    type: 'general:patch';
    patch: Partial<General<TriggerState>>;
    targetId?: GeneralId;
}

export interface GeneralAddEffect<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
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

export interface DiplomacyPatchEffect {
    type: 'diplomacy:patch';
    srcNationId: NationId;
    destNationId: NationId;
    patch: {
        state?: number;
        term?: number;
        dead?: number;
        deadDelta?: number;
        meta?: Record<string, unknown>;
    };
}

export interface LogEffect {
    type: 'log';
    entry: LogEntryDraft;
}

export interface NextTurnOverrideEffect {
    type: 'schedule:override';
    nextTurnAt: Date;
}

export type GeneralActionEffect<TriggerState extends GeneralTriggerState = GeneralTriggerState> =
    | GeneralPatchEffect<TriggerState>
    | GeneralAddEffect<TriggerState>
    | CityPatchEffect
    | NationPatchEffect
    | NationAddEffect
    | DiplomacyPatchEffect
    | LogEffect
    | NextTurnOverrideEffect;

export interface GeneralActionOutcome<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    effects: GeneralActionEffect<TriggerState>[];
    alternative?: {
        commandKey: string;
        args: unknown;
    };
}

export interface GeneralActionResolver<TriggerState extends GeneralTriggerState = GeneralTriggerState, Args = unknown> {
    key: string;
    resolve(context: GeneralActionResolveContext<TriggerState>, args: Args): GeneralActionOutcome<TriggerState>;
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
        nations?: Nation[];
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
    alternative?: {
        commandKey: string;
        args: unknown;
    };
}

export const createGeneralPatchEffect = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    patch: Partial<General<TriggerState>>,
    targetId?: GeneralId
): GeneralPatchEffect<TriggerState> => ({
    type: 'general:patch',
    patch,
    ...(targetId !== undefined ? { targetId } : {}),
});

export const createGeneralAddEffect = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    general: General<TriggerState>
): GeneralAddEffect<TriggerState> => ({
    type: 'general:add',
    general,
});

export const createCityPatchEffect = (patch: Partial<City>, targetId?: CityId): CityPatchEffect => ({
    type: 'city:patch',
    patch,
    ...(targetId !== undefined ? { targetId } : {}),
});

export const createNationPatchEffect = (patch: Partial<Nation>, targetId?: NationId): NationPatchEffect => ({
    type: 'nation:patch',
    patch,
    ...(targetId !== undefined ? { targetId } : {}),
});

export interface NationAddEffect {
    type: 'nation:add';
    nation: Nation;
}

export const createNationAddEffect = (nation: Nation): NationAddEffect => ({
    type: 'nation:add',
    nation,
});

export const createDiplomacyPatchEffect = (
    srcNationId: NationId,
    destNationId: NationId,
    patch: DiplomacyPatchEffect['patch']
): DiplomacyPatchEffect => ({
    type: 'diplomacy:patch',
    srcNationId,
    destNationId,
    patch,
});

export const createLogEffect = (message: string, options: Partial<Omit<LogEntryDraft, 'text'>> = {}): LogEffect => ({
    type: 'log',
    entry: {
        scope: options.scope ?? LogScope.GENERAL,
        category: options.category ?? LogCategory.ACTION,
        text: message,
        ...(options.generalId !== undefined ? { generalId: options.generalId } : {}),
        ...(options.nationId !== undefined ? { nationId: options.nationId } : {}),
        ...(options.userId !== undefined ? { userId: options.userId } : {}),
        ...(options.subType !== undefined ? { subType: options.subType } : {}),
        ...(options.meta !== undefined ? { meta: options.meta } : {}),
        format: options.format ?? LogFormat.MONTH,
    },
});

export const createNextTurnOverrideEffect = (nextTurnAt: Date): NextTurnOverrideEffect => ({
    type: 'schedule:override',
    nextTurnAt,
});

// 행동 결과를 Effect로 모아 상태/턴 계산을 수행한다.
export const resolveGeneralAction = <TriggerState extends GeneralTriggerState = GeneralTriggerState, Args = unknown>(
    resolver: GeneralActionResolver<TriggerState, Args>,
    context: GeneralActionResolveInputContext<TriggerState>,
    scheduleContext: TurnScheduleContext,
    args: Args
): GeneralActionResolution => {
    const logs: LogEntryDraft[] = [];
    let nextTurnAtOverride: Date | null = null;
    const createdGenerals: General[] = [];
    const createdNations: Nation[] = [];
    const patches: NonNullable<GeneralActionResolution['patches']> = {
        generals: [],
        cities: [],
        nations: [],
    };

    const pendingEffects: GeneralActionEffect[] = [];
    let outcome: GeneralActionOutcome<TriggerState> | undefined;
    const [nextWorld, worldPatches] = produceWithPatches(
        {
            general: context.general,
            city: context.city,
            nation: context.nation,
        } as WorldState<TriggerState>,
        (draft) => {
            const addLog = (message: string, options: Partial<Omit<LogEntryDraft, 'text'>> = {}) => {
                const entry: LogEntryDraft = {
                    scope: options.scope ?? LogScope.GENERAL,
                    category: options.category ?? LogCategory.ACTION,
                    text: message,
                    format: options.format ?? LogFormat.MONTH,
                    ...options,
                };

                switch (entry.scope) {
                    case LogScope.GENERAL:
                        logs.push({
                            ...entry,
                            generalId: entry.generalId ?? context.general.id,
                        });
                        break;
                    case LogScope.NATION:
                        if (entry.nationId !== undefined) {
                            logs.push(entry);
                            break;
                        }
                        if (context.nation?.id !== undefined) {
                            logs.push({
                                ...entry,
                                nationId: context.nation.id,
                            });
                        }
                        break;
                    case LogScope.USER:
                        if (entry.userId) {
                            logs.push(entry);
                        }
                        break;
                    case LogScope.SYSTEM:
                    default:
                        logs.push(entry);
                        break;
                }
            };

            outcome = resolver.resolve(
                {
                    ...context,
                    // ...
                    general: castDraft(draft.general),
                    city: castDraft(draft.city),
                    nation: castDraft(draft.nation),
                    addLog,
                } as GeneralActionResolveContext<TriggerState>,
                args
            );

            for (const effect of outcome.effects) {
                switch (effect.type) {
                    case 'log':
                        addLog(effect.entry.text, effect.entry);
                        break;
                    case 'schedule:override':
                        nextTurnAtOverride = effect.nextTurnAt;
                        break;
                    case 'general:add':
                        createdGenerals.push(effect.general as General);
                        break;
                    case 'nation:add':
                        createdNations.push(effect.nation as Nation);
                        break;
                    case 'diplomacy:patch':
                        pendingEffects.push(effect);
                        break;
                    case 'general:patch':
                    case 'city:patch':
                    case 'nation:patch':
                        // 타겟이 다른 경우 patches에 추가
                        if (
                            effect.type === 'general:patch' &&
                            effect.targetId !== undefined &&
                            effect.targetId !== context.general.id
                        ) {
                            patches.generals.push({
                                id: effect.targetId,
                                patch: effect.patch as Partial<General>,
                            });
                        } else if (effect.type === 'general:patch') {
                            Object.assign(draft.general, effect.patch);
                        } else if (
                            effect.type === 'city:patch' &&
                            effect.targetId !== undefined &&
                            effect.targetId !== context.city?.id
                        ) {
                            patches.cities.push({
                                id: effect.targetId,
                                patch: effect.patch,
                            });
                        } else if (effect.type === 'city:patch' && draft.city) {
                            Object.assign(draft.city, effect.patch);
                        } else if (
                            effect.type === 'nation:patch' &&
                            effect.targetId !== undefined &&
                            effect.targetId !== context.nation?.id
                        ) {
                            patches.nations.push({
                                id: effect.targetId,
                                patch: effect.patch,
                            });
                        } else if (effect.type === 'nation:patch' && draft.nation) {
                            Object.assign(draft.nation, effect.patch);
                        }
                        break;
                }
            }
        }
    );

    const nextTurnAt = nextTurnAtOverride ?? getNextTurnAt(scheduleContext.now, scheduleContext.schedule);

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
        effects: pendingEffects,
        ...(outcome?.alternative ? { alternative: outcome.alternative } : {}),
    };
    if (nextWorld.city) {
        resolution.city = nextWorld.city as City;
    }
    if (dirty.general || dirty.city || dirty.nation) {
        resolution.dirty = dirty;
    }
    if (patches.generals.length > 0 || patches.cities.length > 0 || patches.nations.length > 0) {
        resolution.patches = patches;
    }
    if (createdGenerals.length > 0 || createdNations.length > 0) {
        resolution.created = {
            generals: createdGenerals,
            ...(createdNations.length > 0 ? { nations: createdNations } : {}),
        };
    }

    return resolution;
};
