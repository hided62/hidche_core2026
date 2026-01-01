import type { GeneralTriggerState } from '../../../domain/entities.js';
import { CityDevelopmentActionDefinition } from './cityDevelopment.js';
import type { TurnCommandEnv } from '../commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> extends CityDevelopmentActionDefinition<TriggerState> {
    constructor(env: { develCost?: number; amount?: number } = {}) {
        super(
            {
                key: 'che_치안강화',
                name: '치안 강화',
                statKey: 'security',
                maxKey: 'securityMax',
                label: '치안',
                baseAmount: 50,
            },
            env
        );
    }
}

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_치안강화',
    category: '내정',
    reqArg: false,
    args: {},
    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition({ develCost: env.develCost }),
};
