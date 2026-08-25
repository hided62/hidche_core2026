import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from './engine.js';
import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';

export interface GeneralActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
    Args = unknown,
    Context extends GeneralActionResolveContext<TriggerState> = GeneralActionResolveContext<TriggerState>,
> {
    key: string;
    name: string;
    parseArgs(raw: unknown): Args | null;
    // 레거시 testPermissionToReserve()와 같은 예약 입력 전용 제약이다.
    // 정의하지 않은 명령은 레거시처럼 인자 검증 외 상태 제약 없이 예약한다.
    buildPermissionConstraints?(ctx: ConstraintContext, args: Args): Constraint[];
    // 커맨드 입력 단계에서 최소 조건만 평가할 때 사용한다.
    buildMinConstraints?(ctx: ConstraintContext, args: Args): Constraint[];
    buildConstraints(ctx: ConstraintContext, args: Args): Constraint[];
    formatConstraintFailure?(reason: string, ctx: ConstraintContext, args: Args, view: StateView): string | null;
    // NationCommand::addTermStack()/setNextAvailable() 호환 실행 메타데이터.
    getPreReqTurn?(context: Context, args: Args): number;
    // 입력 시점에 대상이 정해져야 소요 턴을 계산할 수 있는 명령의 Ref 표시 문구.
    getTurnDurationHint?(): string;
    getPostReqTurn?(context: Context, args: Args): number;
    getStackSequence?(context: Context, args: Args): number | null;
    getProgressText?(context: Context, args: Args, term: number, termMax: number): string;
    readonly countsAsInheritanceActiveAction?: boolean;
    getInheritanceActiveActionAmount?(context: Context, args: Args): number;
    resolve(context: Context, args: Args): GeneralActionOutcome<TriggerState>;
}
