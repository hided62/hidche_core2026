import type { GeneralTriggerState } from '../../../domain/entities.js';
import { CityDevelopmentActionDefinition } from './cityDevelopment.js';

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
