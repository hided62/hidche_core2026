import type { GeneralActionDefinition } from '../definition.js';
import type { GeneralActionResolver } from '../engine.js';
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
    ActionDefinition: new (...args: any[]) => GeneralActionDefinition;
    ActionResolver?: new (...args: any[]) => GeneralActionResolver;
    CommandResolver?: new (...args: any[]) => unknown;
}
