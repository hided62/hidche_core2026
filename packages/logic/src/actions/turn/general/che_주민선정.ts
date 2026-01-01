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
                key: 'che_주민선정',
                name: '주민 선정',
                statKey: 'population',
                maxKey: 'populationMax',
                label: '인구',
                baseAmount: 1000,
            },
            env
        );
    }
}

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_주민선정',
    category: '내정',
    reqArg: false,
    args: {},
    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition({ develCost: env.develCost }),
};
