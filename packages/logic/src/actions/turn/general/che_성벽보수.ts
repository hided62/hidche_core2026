import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { ActionDefinition as DomesticActionDefinition, actionContextBuilder } from './che_상업투자.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends DomesticActionDefinition<TriggerState> {
    constructor(env: TurnCommandEnv) {
        super(env.generalActionModules ?? [], env, {
            key: 'che_성벽보수',
            name: '성벽 보수',
            actionKey: '성벽',
            statKey: 'strength',
            statExpKey: 'strength_exp',
            cityKey: 'wall',
            cityMaxKey: 'wallMax',
            frontDebuff: 0.25,
        });
    }
}

export { actionContextBuilder };

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_성벽보수',
    category: '내정',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
