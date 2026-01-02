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
    GeneralActionResolver,
} from '../../engine.js';
import type { TurnCommandEnv } from '../commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';

export interface NationRestArgs {}

const ACTION_NAME = '휴식';

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
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
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements GeneralActionDefinition<TriggerState, NationRestArgs> {
    public readonly key = '휴식';
    public readonly name = ACTION_NAME;
    private readonly resolver = new ActionResolver<TriggerState>();

    parseArgs(_raw: unknown): NationRestArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(
        _ctx: ConstraintContext,
        _args: NationRestArgs
    ): Constraint[] {
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

export const commandSpec: NationTurnCommandSpec = {
    key: '휴식',
    category: '휴식',
    reqArg: false,
    args: {},
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
