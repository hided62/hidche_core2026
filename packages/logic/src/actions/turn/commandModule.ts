import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { ActionContextBuilder } from './actionContext.js';
import type { TurnCommandEnv } from './commandEnv.js';

export interface TurnCommandSpecBase<TKey extends string = string> {
    key: TKey;
    category: string;
    reqArg: boolean;
    args: Record<string, unknown>;
    createDefinition(env: TurnCommandEnv): GeneralActionDefinition;
}

export interface TurnCommandModule<TSpec extends TurnCommandSpecBase = TurnCommandSpecBase> {
    commandSpec: TSpec;
    actionContextBuilder?: ActionContextBuilder;
}
