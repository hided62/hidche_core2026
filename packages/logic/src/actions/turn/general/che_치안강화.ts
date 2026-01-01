import type { GeneralTriggerState } from '../../../domain/entities.js';
import { CityDevelopmentActionDefinition } from './cityDevelopment.js';

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
