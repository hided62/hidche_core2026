import type { GeneralTriggerState } from '../../../domain/entities.js';
import { CityDevelopmentActionDefinition } from './cityDevelopment.js';

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
