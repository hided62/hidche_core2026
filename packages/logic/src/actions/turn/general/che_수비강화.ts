import type { GeneralTriggerState } from '../../../domain/entities.js';
import { CityDevelopmentActionDefinition } from './cityDevelopment.js';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> extends CityDevelopmentActionDefinition<TriggerState> {
    constructor(env: { develCost?: number; amount?: number } = {}) {
        super(
            {
                key: 'che_수비강화',
                name: '수비 강화',
                statKey: 'defence',
                maxKey: 'defenceMax',
                label: '수비',
                baseAmount: 50,
            },
            env
        );
    }
}
