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

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_성벽보수',
    category: '내정',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition({ develCost: env.develCost }),
};
