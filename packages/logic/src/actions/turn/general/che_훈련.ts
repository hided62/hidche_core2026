import type {
    GeneralTriggerState,
} from '@sammo-ts/logic/domain/entities.js';
import type {
    Constraint,
    ConstraintContext,
    StateView,
} from '@sammo-ts/logic/constraints/types.js';
import { notBeNeutral, reqGeneralGold } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { clamp } from 'es-toolkit';

export interface TrainingArgs {}

export interface TrainingEnvironment {
    trainDelta?: number;
    maxTrainByCommand?: number;
    costGold?: number;
}

const ACTION_NAME = '훈련';
const DEFAULT_TRAIN_DELTA = 5;
const DEFAULT_MAX_TRAIN = 100;

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements GeneralActionDefinition<TriggerState, TrainingArgs> {
    public readonly key = 'che_훈련';
    public readonly name = ACTION_NAME;
    private readonly env: TrainingEnvironment;

    constructor(env: TrainingEnvironment = {}) {
        this.env = env;
    }

    parseArgs(_raw: unknown): TrainingArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(
        _ctx: ConstraintContext,
        _args: TrainingArgs
    ): Constraint[] {
        const getRequiredGold = (_context: ConstraintContext, _view: StateView): number =>
            this.env.costGold ?? 0;
        return [notBeNeutral(), reqGeneralGold(getRequiredGold)];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: TrainingArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const maxTrain =
            this.env.maxTrainByCommand && this.env.maxTrainByCommand > 0
                ? this.env.maxTrainByCommand
                : DEFAULT_MAX_TRAIN;
        const delta =
            this.env.trainDelta && this.env.trainDelta > 0
                ? this.env.trainDelta
                : DEFAULT_TRAIN_DELTA;
        const nextTrain = clamp(general.train + delta, 0, maxTrain);
        const applied = nextTrain - general.train;
        const costGold = this.env.costGold ?? 0;

        // 직접 수정 (Immer Draft)
        general.train = nextTrain;
        general.gold = Math.max(0, general.gold - costGold);

        context.addLog(`${ACTION_NAME}을 통해 훈련도가 ${applied} 증가했습니다.`);

        return { effects: [] };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_훈련',
    category: '군사',
    reqArg: false,
    args: {},
    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition({
            trainDelta: env.trainDelta,
            maxTrainByCommand: env.maxTrainByCommand,
        }),
};
