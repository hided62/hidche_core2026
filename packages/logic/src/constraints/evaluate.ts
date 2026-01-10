import type { Constraint, ConstraintContext, ConstraintResult, RequirementKey, StateView } from './types.js';

export const evaluateConstraints = (
    constraints: Constraint[],
    ctx: ConstraintContext,
    view: StateView
): ConstraintResult => {
    for (const constraint of constraints) {
        const missing = constraint.requires(ctx).filter((req) => !view.has(req));
        if (missing.length > 0 && ctx.mode === 'precheck') {
            return { kind: 'unknown', missing };
        }
        const result = constraint.test(ctx, view);
        if (result.kind === 'deny') {
            return {
                ...result,
                constraintName: result.constraintName ?? constraint.name,
            };
        }
        if (result.kind !== 'allow') {
            return result;
        }
    }
    return { kind: 'allow' };
};

export const collectRequirements = (constraints: Constraint[], ctx: ConstraintContext): RequirementKey[] => {
    const keys: RequirementKey[] = [];
    for (const constraint of constraints) {
        keys.push(...constraint.requires(ctx));
    }
    return keys;
};

export interface ActionWithConstraints {
    buildConstraints(ctx: ConstraintContext, args: unknown): Constraint[];
}

export const evaluateActionConstraints = <Args>(
    action: ActionWithConstraints,
    ctx: ConstraintContext,
    view: StateView,
    args: Args
): ConstraintResult => {
    const constraints = action.buildConstraints(ctx, args);
    return evaluateConstraints(constraints, ctx, view);
};
