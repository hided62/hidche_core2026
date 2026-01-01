import type { GeneralTriggerState } from '../../../domain/entities.js';
import { CityDevelopmentActionDefinition } from './cityDevelopment.js';

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
