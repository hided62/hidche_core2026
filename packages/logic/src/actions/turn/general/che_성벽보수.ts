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
                key: 'che_성벽보수',
                name: '성벽 보수',
                statKey: 'wall',
                maxKey: 'wallMax',
                label: '성벽',
                baseAmount: 50,
            },
            env
        );
    }
}

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_성벽보수',
    category: '내정',
    reqArg: false,
    args: {},
    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition({ develCost: env.develCost }),
};
