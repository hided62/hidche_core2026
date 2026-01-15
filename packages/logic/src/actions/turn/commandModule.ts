import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { ZodType } from 'zod';
import type { ActionContextBuilder } from './actionContext.js';
import type { TurnCommandEnv } from './commandEnv.js';

export interface TurnCommandSpecWithArgs<TKey extends string = string> {
    key: TKey;
    category: string;
    reqArg: true;
    availabilityArgs: Readonly<Record<string, unknown>>;
    argsSchema: ZodType<Record<string, unknown>>;
    createDefinition(env: TurnCommandEnv): GeneralActionDefinition;
}

export interface TurnCommandSpecWithoutArgs<TKey extends string = string> {
    key: TKey;
    category: string;
    reqArg: false;
    argsSchema?: undefined;
    createDefinition(env: TurnCommandEnv): GeneralActionDefinition;
}

export type TurnCommandSpecBase<TKey extends string = string> =
    | TurnCommandSpecWithArgs<TKey>
    | TurnCommandSpecWithoutArgs<TKey>;

export type TurnCommandArgs<TSpec extends TurnCommandSpecBase> = TSpec extends {
    argsSchema: ZodType<infer TArgs>;
}
    ? TArgs
    : Record<string, never>;

export interface TurnCommandModule<TSpec extends TurnCommandSpecBase = TurnCommandSpecBase> {
    commandSpec: TSpec;
    actionContextBuilder?: ActionContextBuilder<TurnCommandArgs<TSpec>>;
}
