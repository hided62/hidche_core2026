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

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_농지개간',
    category: '내정',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition({ develCost: env.develCost }),
};
