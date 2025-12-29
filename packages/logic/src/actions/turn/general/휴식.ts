import type {
    GeneralTriggerState,
} from '../../../domain/entities.js';
import type {
    Constraint,
    ConstraintContext,
} from '../../../constraints/types.js';
import type { GeneralActionDefinition } from '../../definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '../../engine.js';
import { createLogEffect } from '../../engine.js';
import { LogCategory, LogFormat, LogScope } from '../../../logging/types.js';

export interface RestArgs {}

const ACTION_NAME = '휴식';

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    resolve(
        _context: GeneralActionResolveContext<TriggerState>,
        _args: RestArgs
    ): GeneralActionOutcome<TriggerState> {
        void _context;
        void _args;
        return {
            effects: [
                createLogEffect('아무것도 실행하지 않았습니다.', {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }),
            ],
        };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements GeneralActionDefinition<TriggerState, RestArgs> {
    public readonly key = '휴식';
    public readonly name = ACTION_NAME;
    private readonly resolver = new ActionResolver<TriggerState>();

    parseArgs(_raw: unknown): RestArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(
        _ctx: ConstraintContext,
        _args: RestArgs
    ): Constraint[] {
        void _ctx;
        void _args;
        return [];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: RestArgs
    ): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}
