import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    occupiedCity,
    reqGeneralCrew,
    reqGeneralTrainMargin,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
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
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
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

    buildMinConstraints(_ctx: ConstraintContext, _args: TrainingArgs): Constraint[] {
        return [notBeNeutral(), notWanderingNation(), occupiedCity()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: TrainingArgs): Constraint[] {
        const maxTrain =
            this.env.maxTrainByCommand && this.env.maxTrainByCommand > 0
                ? this.env.maxTrainByCommand
                : DEFAULT_MAX_TRAIN;
        return [notBeNeutral(), notWanderingNation(), occupiedCity(), reqGeneralCrew(), reqGeneralTrainMargin(maxTrain)];
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
        const delta = this.env.trainDelta && this.env.trainDelta > 0 ? this.env.trainDelta : DEFAULT_TRAIN_DELTA;
        const nextTrain = clamp(general.train + delta, 0, maxTrain);
        const applied = nextTrain - general.train;
        const costGold = this.env.costGold ?? 0;

        // 직접 수정 (Immer Draft)
        general.train = nextTrain;
        general.gold = Math.max(0, general.gold - costGold);

        context.addLog(`훈련치가 <C>${applied}</> 상승했습니다.`);
        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        return { effects: [] };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_훈련',
    category: '군사',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition({
            trainDelta: env.trainDelta,
            maxTrainByCommand: env.maxTrainByCommand,
        }),
};
