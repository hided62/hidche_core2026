import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import { notBeNeutral, reqGeneralGold } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface RecoveryArgs {}

export interface RecoveryEnvironment {
    injuryDelta?: number;
    costGold?: number;
}

const ACTION_NAME = '요양';
const DEFAULT_INJURY_DELTA = 10;

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, RecoveryArgs> {
    public readonly key = 'che_요양';
    public readonly name = ACTION_NAME;
    private readonly env: RecoveryEnvironment;

    constructor(env: RecoveryEnvironment = {}) {
        this.env = env;
    }

    parseArgs(_raw: unknown): RecoveryArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: RecoveryArgs): Constraint[] {
        const getRequiredGold = (_context: ConstraintContext, _view: StateView): number => this.env.costGold ?? 0;
        return [notBeNeutral(), reqGeneralGold(getRequiredGold)];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: RecoveryArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const delta = this.env.injuryDelta ?? DEFAULT_INJURY_DELTA;
        const nextInjury = Math.max(0, general.injury - delta);
        const applied = general.injury - nextInjury;
        const costGold = this.env.costGold ?? 0;

        // 직접 수정 (Immer Draft)
        general.injury = nextInjury;
        general.gold = Math.max(0, general.gold - costGold);

        context.addLog(`${ACTION_NAME}으로 부상이 ${applied} 회복되었습니다.`);

        return { effects: [] };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_요양',
    category: '개인',
    reqArg: false,

    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
