import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from './engine.js';
import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';

export interface GeneralActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
    Args = unknown,
    Context extends GeneralActionResolveContext<TriggerState> = GeneralActionResolveContext<TriggerState>
> {
    key: string;
    name: string;
    parseArgs(raw: unknown): Args | null;
    buildConstraints(ctx: ConstraintContext, args: Args): Constraint[];
    resolve(context: Context, args: Args): GeneralActionOutcome<TriggerState>;
}
