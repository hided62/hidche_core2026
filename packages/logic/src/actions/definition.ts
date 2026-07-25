import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from './engine.js';
import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';

export interface GeneralActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
    Args = unknown,
    Context extends GeneralActionResolveContext<TriggerState> = GeneralActionResolveContext<TriggerState>,
> {
    // TODO: legacy permissionConstraints(예약 권한) 모델링 필요.
    key: string;
    name: string;
    parseArgs(raw: unknown): Args | null;
    // 커맨드 입력 단계에서 최소 조건만 평가할 때 사용한다.
    buildMinConstraints?(ctx: ConstraintContext, args: Args): Constraint[];
    buildConstraints(ctx: ConstraintContext, args: Args): Constraint[];
    // NationCommand::addTermStack()/setNextAvailable() 호환 실행 메타데이터.
    getPreReqTurn?(context: Context, args: Args): number;
    getPostReqTurn?(context: Context, args: Args): number;
    getStackSequence?(context: Context, args: Args): number | null;
    readonly countsAsInheritanceActiveAction?: boolean;
    resolve(context: Context, args: Args): GeneralActionOutcome<TriggerState>;
}
