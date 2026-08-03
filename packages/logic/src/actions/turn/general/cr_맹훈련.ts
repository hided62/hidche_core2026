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
import { createGeneralPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { GeneralActionPipeline } from '@sammo-ts/logic/actionModules/general.js';
import { applyLegacyInjury, finalizeLegacyStat } from './legacyGeneralStat.js';

const ACTION_NAME = '맹훈련';
const ACTION_KEY = 'cr_맹훈련';

export interface FierceTrainingArgs {}

const clamp = (value: number, min: number, max: number): number => {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, FierceTrainingArgs> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(private readonly env: TurnCommandEnv) {
        this.pipeline = new GeneralActionPipeline(env.generalActionModules ?? []);
    }

    parseArgs(_raw: unknown): FierceTrainingArgs | null {
        return {};
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: FierceTrainingArgs): Constraint[] {
        return [notBeNeutral(), notWanderingNation(), occupiedCity()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: FierceTrainingArgs): Constraint[] {
        return [
            notBeNeutral(),
            notWanderingNation(),
            occupiedCity(),
            reqGeneralCrew(),
            reqGeneralTrainMargin(this.env.maxTrainByCommand),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: FierceTrainingArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;

        const trainDelta = this.env.trainDelta > 0 ? this.env.trainDelta : 30;
        const maxTrain = this.env.maxTrainByCommand > 0 ? this.env.maxTrainByCommand : 100;
        const maxAtmos = this.env.maxAtmosByCommand > 0 ? this.env.maxAtmosByCommand : 100;

        const leadership = finalizeLegacyStat(
            this.pipeline.onCalcStat(context, 'leadership', applyLegacyInjury(general.stats.leadership, general.injury))
        );
        const score = Math.round((leadership * 100 * trainDelta * 2) / (Math.max(general.crew, 1) * 3));
        const scoreText = score.toLocaleString('en-US');

        context.addLog(`훈련, 사기치가 <C>${scoreText}</> 상승했습니다.`, {
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        const nextTrain = clamp(general.train + score, 0, maxTrain);
        const nextAtmos = clamp(general.atmos + score, 0, maxAtmos);
        const leadershipExp = typeof general.meta.leadership_exp === 'number' ? general.meta.leadership_exp : 0;
        const crewType = this.env.unitSet?.crewTypes?.find((entry) => entry.id === general.crewTypeId);
        const dexKey = crewType ? `dex${crewType.armType}` : null;
        const currentDex = dexKey && typeof general.meta[dexKey] === 'number' ? general.meta[dexKey] : 0;

        return {
            effects: [
                createGeneralPatchEffect<TriggerState>({
                    train: nextTrain,
                    atmos: nextAtmos,
                    experience: general.experience + 150,
                    dedication: general.dedication + 100,
                    meta: {
                        ...general.meta,
                        leadership_exp: leadershipExp + 1,
                        ...(dexKey ? { [dexKey]: currentDex + score * 2 } : {}),
                    },
                }),
            ],
        };
    }
}

export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: ACTION_KEY,
    category: '군사',
    reqArg: false,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
