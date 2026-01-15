import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { notBeNeutral, notWanderingNation, occupiedCity, suppliedCity } from '@sammo-ts/logic/constraints/presets.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface ProcureArgs {}

const ACTION_NAME = '물자조달';
const ACTION_KEY = 'che_물자조달';

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, ProcureArgs> {
    readonly key = ACTION_KEY;
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.pipeline = new GeneralActionPipeline(modules);
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: ProcureArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;

        if (!nation) {
            throw new Error('Procure requires a nation context.');
        }

        // 1. Choose Gold or Rice
        const picked = context.rng.nextBool(0.5) ? 'gold' : 'rice';
        const resName = picked === 'gold' ? '금' : '쌀';
        const resKey = picked === 'gold' ? 'gold' : 'rice';

        // 2. Base Score
        let score = general.stats.leadership + general.stats.strength + general.stats.intelligence;

        // Domestic Bonus (Hardcoded simplified logic or need helper)
        // In legacy: getDomesticExpLevelBonus($general->getVar('explevel'))
        // For now, assume simplified or no bonus unless strictly required to port helper.
        // Assuming 1.0 for now if helper not available, or implement simple bonus.
        // Legacy: $score *= $rng->nextRange(0.8, 1.2);
        score *= context.rng.nextFloat() * 0.4 + 0.8;

        // 3. Success/Fail Ratio
        let successRatio = 0.1;
        let failRatio = 0.3;

        successRatio = this.pipeline.onCalcDomestic(context, '조달', 'success', successRatio);
        failRatio = this.pipeline.onCalcDomestic(context, '조달', 'fail', failRatio);

        // 4. Determine Outcome
        const roll = context.rng.nextFloat();
        let outcome: 'fail' | 'success' | 'normal' = 'normal';

        if (roll < failRatio) {
            outcome = 'fail';
        } else if (roll < failRatio + successRatio) {
            outcome = 'success';
        }

        // 5. Critical Score Modifier
        // Legacy: CriticalScoreEx($rng, $pick);
        // fail -> 0.5, success -> 1.5, normal -> 1.0 roughly
        if (outcome === 'fail') {
            score *= 0.5;
        } else if (outcome === 'success') {
            score *= 1.5;
        }

        score = this.pipeline.onCalcDomestic(context, '조달', 'score', score);
        score = Math.floor(score);

        // 6. Calculate Exp/Dedication
        const exp = (score * 0.7) / 3;
        const ded = (score * 1.0) / 3;

        // 7. Update General
        const nextExp = general.experience + Math.floor(exp);
        const nextDed = general.dedication + Math.floor(ded);

        // Stat Exp
        // Legacy: choose weighted among L/S/I
        const statChoice =
            context.rng.nextFloat() * (general.stats.leadership + general.stats.strength + general.stats.intelligence);
        let statKey: 'leadership_exp' | 'strength_exp' | 'intel_exp' = 'leadership_exp';

        if (statChoice < general.stats.leadership) {
            statKey = 'leadership_exp';
        } else if (statChoice < general.stats.leadership + general.stats.strength) {
            statKey = 'strength_exp';
        } else {
            statKey = 'intel_exp';
        }

        // 8. Update Nation
        const nextNationRes = (nation[resKey] ?? 0) + score;

        // 9. Logging
        const scoreText = score.toLocaleString();
        if (outcome === 'fail') {
            context.addLog(
                `조달을 <span class='ev_failed'>실패</span>하여 ${resName}을 <C>${scoreText}</> 조달했습니다.`,
                {
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }
            );
        } else if (outcome === 'success') {
            context.addLog(`조달을 <S>성공</>하여 ${resName}을 <C>${scoreText}</> 조달했습니다.`, {
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
        } else {
            context.addLog(`${resName}을 <C>${scoreText}</> 조달했습니다.`, {
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
        }

        return {
            effects: [
                createGeneralPatchEffect(
                    {
                        ...general,
                        experience: nextExp,
                        dedication: nextDed,
                        meta: {
                            ...general.meta,
                            [statKey]:
                                (typeof general.meta[statKey] === 'number' ? (general.meta[statKey] as number) : 0) + 1,
                        },
                    },
                    general.id
                ),
                createNationPatchEffect(
                    {
                        ...nation,
                        [resKey]: nextNationRes,
                    },
                    nation.id
                ),
            ],
        };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, ProcureArgs, GeneralActionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.resolver = new ActionResolver(modules);
    }

    parseArgs(_raw: unknown): ProcureArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: ProcureArgs): Constraint[] {
        return [notBeNeutral(), notWanderingNation(), occupiedCity(), suppliedCity()];
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: ProcureArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_물자조달',
    category: '내정',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? []),
};
