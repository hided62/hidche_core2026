import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface RestArgs {}

const ACTION_NAME = '휴식';

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, RestArgs> {
    readonly key = '휴식';

    resolve(context: GeneralActionResolveContext<TriggerState>, _args: RestArgs): GeneralActionOutcome<TriggerState> {
        context.addLog('아무것도 실행하지 않았습니다.', {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        return { effects: [] };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, RestArgs> {
    public readonly key = '휴식';
    public readonly name = ACTION_NAME;
    private readonly resolver = new ActionResolver<TriggerState>();

    parseArgs(_raw: unknown): RestArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: RestArgs): Constraint[] {
        void _ctx;
        void _args;
        return [];
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: RestArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: '휴식',
    category: '개인',
    reqArg: false,

    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
