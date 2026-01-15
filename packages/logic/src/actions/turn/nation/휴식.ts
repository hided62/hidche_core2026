import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { NationTurnCommandSpec } from './index.js';

export interface NationRestArgs {}

const ACTION_NAME = '휴식';

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, NationRestArgs> {
    readonly key = '휴식';

    resolve(
        _context: GeneralActionResolveContext<TriggerState>,
        _args: NationRestArgs
    ): GeneralActionOutcome<TriggerState> {
        void _context;
        void _args;
        return { effects: [] };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, NationRestArgs> {
    public readonly key = '휴식';
    public readonly name = ACTION_NAME;
    private readonly resolver = new ActionResolver<TriggerState>();

    parseArgs(_raw: unknown): NationRestArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: NationRestArgs): Constraint[] {
        void _ctx;
        void _args;
        return [];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: NationRestArgs
    ): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: NationTurnCommandSpec = {
    key: '휴식',
    category: '휴식',
    reqArg: false,

    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
