import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { CityDevelopmentActionDefinition } from './cityDevelopment.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
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

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_치안강화',
    category: '내정',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition({ develCost: env.develCost }),
};
