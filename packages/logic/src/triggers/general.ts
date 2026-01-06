import type { General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { RandomGenerator } from '@sammo-ts/common';
import type { WorldStateRepository } from '@sammo-ts/logic/ports/world.js';
import { TriggerCaller, type Trigger } from './core.js';

export interface GeneralWorldView<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    listGenerals(): General<TriggerState>[];
    listGeneralsByCity?(cityId: number): General<TriggerState>[];
}

export interface GeneralActionLogSink {
    push(message: string): void;
}

export interface GeneralSkillActivation {
    has(key: string): boolean;
    activate(...keys: string[]): void;
}

export const createGeneralSkillActivation = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>
): GeneralSkillActivation => ({
    has: (key: string) => Boolean(general.triggerState.flags[key]),
    activate: (...keys: string[]) => {
        for (const key of keys) {
            general.triggerState.flags[key] = true;
        }
    },
});

export interface GeneralActionContext<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    general: General<TriggerState>;
    nation?: Nation | null;
    world?: WorldStateRepository;
    worldView?: GeneralWorldView<TriggerState>;
    log?: GeneralActionLogSink;
    rng?: RandomGenerator;
}

export interface GeneralTriggerContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionContext<TriggerState> {
    rng: RandomGenerator;
    skill: GeneralSkillActivation;
}

export const createGeneralTriggerContext = <TriggerState extends GeneralTriggerState>(
    context: GeneralActionContext<TriggerState> & { rng: RandomGenerator }
): GeneralTriggerContext<TriggerState> => ({
    ...context,
    skill: createGeneralSkillActivation(context.general),
});

export type GeneralTrigger<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
    Env extends Record<string, unknown> = Record<string, unknown>,
    Arg = unknown,
> = Trigger<GeneralTriggerContext<TriggerState>, Env, Arg>;

export class GeneralTriggerCaller<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
    Env extends Record<string, unknown> = Record<string, unknown>,
    Arg = unknown,
> extends TriggerCaller<GeneralTriggerContext<TriggerState>, Env, Arg> {}

export abstract class BaseGeneralTrigger<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
    Env extends Record<string, unknown> = Record<string, unknown>,
    Arg = unknown,
> implements GeneralTrigger<TriggerState, Env, Arg> {
    public abstract readonly priority: number;

    protected constructor(protected readonly general: General<TriggerState>) {}

    get uniqueId(): string {
        return `${this.priority}_${this.constructor.name}_${this.general.id}`;
    }

    abstract action(context: GeneralTriggerContext<TriggerState>, env: Env, arg?: Arg): Env;
}
