import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { notBeNeutral, notWanderingNation, occupiedCity, suppliedCity } from '@sammo-ts/logic/constraints/presets.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface ProcureArgs {}
interface ProcureContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    relYear?: number;
}

const ACTION_NAME = '물자조달';
const ACTION_KEY = 'che_물자조달';

export const roundLegacyAccumulatedInteger = (current: number, delta: number): number => Math.round(current + delta);

export const resolveLegacyExperienceLevel = (experience: number): number =>
    Math.max(
        0,
        Math.min(255, experience < 1_000 ? Math.trunc(experience / 100) : Math.trunc(Math.sqrt(experience / 10)))
    );
export const resolveLegacyDedicationLevel = (dedication: number): number =>
    Math.max(0, Math.min(30, Math.ceil(Math.sqrt(dedication) / 10)));

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, ProcureArgs> {
    readonly key = ACTION_KEY;
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>) {
        this.pipeline = new GeneralActionPipeline(modules);
    }

    resolve(context: ProcureContext<TriggerState>, _args: ProcureArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;

        if (!nation) {
            throw new Error('Procure requires a nation context.');
        }

        // 1. Choose Gold or Rice
        const picked = context.rng.nextInt(0, 2) === 0 ? 'gold' : 'rice';
        const resName = picked === 'gold' ? '금' : '쌀';
        const resKey = picked === 'gold' ? 'gold' : 'rice';

        // 2. Base Score
        const injuryMultiplier = (100 - general.injury) / 100;
        const rawLeadership = general.stats.leadership * injuryMultiplier;
        const rawStrength = general.stats.strength * injuryMultiplier;
        const rawIntelligence = general.stats.intelligence * injuryMultiplier;
        const maxStat = 255;
        const legacyStat = (stat: 'leadership' | 'strength' | 'intelligence', value: number): number =>
            Math.trunc(Math.max(0, Math.min(maxStat, this.pipeline.onCalcStat(context, stat, value))));
        let score =
            legacyStat('leadership', rawLeadership) +
            legacyStat('strength', rawStrength + Math.round(rawIntelligence / 4)) +
            legacyStat('intelligence', rawIntelligence + Math.round(rawStrength / 4));
        const expLevel = typeof general.meta.explevel === 'number' ? general.meta.explevel : 0;
        score *= 1 + expLevel / 500;
        score *= context.rng.nextFloat1() * 0.4 + 0.8;

        // 3. Success/Fail Ratio
        let successRatio = 0.1;
        let failRatio = 0.3;

        successRatio = this.pipeline.onCalcDomestic(context, '조달', 'success', successRatio);
        failRatio = this.pipeline.onCalcDomestic(context, '조달', 'fail', failRatio);

        // 4. Determine Outcome
        const normalRatio = 1 - failRatio - successRatio;
        let roll = context.rng.nextFloat1() * (failRatio + successRatio + normalRatio);
        let outcome: 'fail' | 'success' | 'normal' = 'normal';

        roll -= failRatio;
        if (roll <= 0) {
            outcome = 'fail';
        } else if (roll - successRatio <= 0) {
            outcome = 'success';
        }

        // 5. Critical Score Modifier
        // Legacy: CriticalScoreEx($rng, $pick);
        // fail -> 0.5, success -> 1.5, normal -> 1.0 roughly
        if (outcome === 'fail') {
            score *= 0.2 + context.rng.nextFloat1() * 0.2;
        } else if (outcome === 'success') {
            score *= 2.2 + context.rng.nextFloat1() * 0.8;
        }

        score = this.pipeline.onCalcDomestic(context, '조달', 'score', score);
        score = Math.round(score);

        // 6. Calculate Exp/Dedication
        const exp = this.pipeline.onCalcStat(context, 'experience', (score * 0.7) / 3);
        const ded = this.pipeline.onCalcStat(context, 'dedication', (score * 1.0) / 3);

        // 7. Update General
        // Ref adds the floating delta to the current value first and MariaDB
        // rounds the accumulated value when it writes the INT column. Rounding
        // the delta separately changes cancellation cases such as
        // 4554 + (45 * 0.7 / 3): the delta is 10.499999999999998, while the
        // accumulated binary value is exactly 4564.5 and persists as 4565.
        const rawNextExp = general.experience + exp;
        const rawNextDed = general.dedication + ded;
        const nextExp = Math.round(rawNextExp);
        const nextDed = Math.round(rawNextDed);

        let appliedScore = score;
        if (context.city && [1, 3].includes(context.city.frontState)) {
            let frontDebuff = 0.5;
            if (nation.capitalCityId === context.city.id && (context.relYear ?? 0) < 25) {
                const debuffScale = Math.max(0, Math.min(20, (context.relYear ?? 0) - 5)) * 0.05;
                frontDebuff = debuffScale * frontDebuff + (1 - debuffScale);
            }
            appliedScore *= frontDebuff;
        }

        // Stat Exp
        // Legacy: choose weighted among L/S/I
        const statChoice =
            context.rng.nextFloat1() * (general.stats.leadership + general.stats.strength + general.stats.intelligence);
        const statKey: 'leadership_exp' | 'strength_exp' | 'intel_exp' =
            statChoice < general.stats.leadership
                ? 'leadership_exp'
                : statChoice < general.stats.leadership + general.stats.strength
                  ? 'strength_exp'
                  : 'intel_exp';

        // 8. Update Nation
        const nextNationRes = (nation[resKey] ?? 0) + Math.trunc(appliedScore);

        // 9. Logging
        const scoreText = Math.round(appliedScore).toLocaleString();
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

        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        return {
            effects: [
                createGeneralPatchEffect(
                    {
                        ...general,
                        experience: nextExp,
                        dedication: nextDed,
                        meta: {
                            ...general.meta,
                            explevel: resolveLegacyExperienceLevel(rawNextExp),
                            dedlevel: resolveLegacyDedicationLevel(rawNextDed),
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

    constructor(modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>) {
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

export const actionContextBuilder: ActionContextBuilder = (base, options) => ({
    ...base,
    ...(typeof options.scenarioMeta?.startYear === 'number'
        ? { relYear: options.world.currentYear - options.scenarioMeta.startYear }
        : {}),
});

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_물자조달',
    category: '내정',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? []),
};
