import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { ActionDefinition as DomesticActionDefinition, actionContextBuilder } from './che_상업투자.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends DomesticActionDefinition<TriggerState> {
    constructor(env: TurnCommandEnv) {
        super(env.generalActionModules ?? [], env, {
            key: 'che_수비강화',
            name: '수비 강화',
            actionKey: '수비',
            statKey: 'strength',
            statExpKey: 'strength_exp',
            cityKey: 'defence',
            cityMaxKey: 'defenceMax',
            frontDebuff: 0.5,
        });
    }
}

export { actionContextBuilder };

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_수비강화',
    category: '내정',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
