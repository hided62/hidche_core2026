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
                key: 'che_농지개간',
                name: '농지 개간',
                statKey: 'agriculture',
                maxKey: 'agricultureMax',
                label: '농업',
                baseAmount: 100,
            },
            env
        );
    }
}

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_농지개간',
    category: '내정',
    reqArg: false,
    args: {},
    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition({ develCost: env.develCost }),
};
