import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { ActionDefinition as DomesticActionDefinition, actionContextBuilder } from './che_상업투자.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends DomesticActionDefinition<TriggerState> {
    constructor(env: TurnCommandEnv) {
        super(env.generalActionModules ?? [], env, {
            key: 'che_농지개간',
            name: '농지 개간',
            actionKey: '농업',
            statKey: 'intelligence',
            statExpKey: 'intel_exp',
            cityKey: 'agriculture',
            cityMaxKey: 'agricultureMax',
            frontDebuff: 0.5,
        });
    }
}

export { actionContextBuilder };

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_농지개간',
    category: '내정',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
