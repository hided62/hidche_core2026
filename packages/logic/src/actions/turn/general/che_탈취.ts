import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    occupiedCity,
    suppliedCity,
    notOccupiedDestCity,
    notNeutralDestCity,
    reqGeneralGold,
    reqGeneralRice,
    disallowDiplomacyBetweenStatus,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
    GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { createCityPatchEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBase, ActionContextOptions } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { JosaUtil } from '@sammo-ts/common';
import { parseArgsWithSchema } from '../parseArgs.js';
import { GeneralActionPipeline } from '@sammo-ts/logic/actionModules/general.js';
import { consumeSuccessfulStrategyItem } from './strategyItemConsumption.js';
import {
    buildStrategyActionContext,
    CommandResolver as StrategyCommandResolver,
    type FireAttackResolveContext,
} from './che_화계.js';

export interface SeizeResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends FireAttackResolveContext<TriggerState> {
    env?: TurnCommandEnv;
    year?: number;
    startYear?: number;
}

const ACTION_NAME = '탈취';
const ACTION_KEY = 'che_탈취';
const ARGS_SCHEMA = z.object({
    destCityId: z.number(),
});
export type SeizeArgs = z.infer<typeof ARGS_SCHEMA>;

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, SeizeArgs> {
    readonly key = ACTION_KEY;
    private readonly pipeline: GeneralActionPipeline<TriggerState>;
    private readonly command: StrategyCommandResolver<TriggerState>;

    constructor(env: TurnCommandEnv) {
        const modules = env.generalActionModules ?? [];
        this.pipeline = new GeneralActionPipeline(modules);
        this.command = new StrategyCommandResolver<TriggerState>(modules, {
            ...env,
            statKey: 'strength',
            damageMode: 'seize',
            injuryGeneral: false,
        });
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: SeizeArgs): GeneralActionOutcome<TriggerState> {
        const ctx = context as SeizeResolveContext<TriggerState>;
        const general = ctx.general;
        const nation = ctx.nation; // Own nation
        const destCity = ctx.destCity;
        const destNation = ctx.destNation;

        if (!destCity) throw new Error('Target city missing');
        const effects: GeneralActionEffect<TriggerState>[] = [];
        const city = ctx.city;
        if (!city) throw new Error('Source city missing');
        const result = this.command.resolve({ ...ctx, city, destCity }, ctx.rng);
        general.gold = Math.max(0, general.gold - result.costGold);
        general.rice = Math.max(0, general.rice - result.costRice);
        general.experience += result.exp;
        general.dedication += result.dedication;
        general.meta.strength_exp = (typeof general.meta.strength_exp === 'number' ? general.meta.strength_exp : 0) + 1;
        if (!result.success) {
            ctx.addLog(
                `<G><b>${destCity.name}</b></>에 ${ACTION_NAME}${JosaUtil.pick(ACTION_NAME, '이')} 실패했습니다.`
            );
            return { effects };
        }
        general.meta.firenum = (typeof general.meta.firenum === 'number' ? general.meta.firenum : 0) + 1;

        const currentYear = ctx.year ?? 200;
        const startYear = ctx.startYear ?? currentYear;
        const yearCoef = Math.sqrt(1 + Math.max(0, currentYear - startYear) / 4) / 2;

        const commRatio = destCity.commerce / destCity.commerceMax;
        const agriRatio = destCity.agriculture / destCity.agricultureMax;

        const rawGold = result.agriDamage * destCity.level * yearCoef * (0.25 + commRatio / 4);
        const rawRice = result.commDamage * destCity.level * yearCoef * (0.25 + agriRatio / 4);

        // 레거시는 탈취량을 부동소수점으로 유지한 채 국가/장수 DB 정수 필드에
        // 기록할 때 반올림한다. 여기서 미리 내림하면 국고와 본국 몫이 1씩
        // 달라질 수 있다.
        let stolenGold = rawGold;
        let stolenRice = rawRice;

        const isSupplied = destCity.supplyState === 1;

        if (isSupplied && destNation) {
            const minGold = 0;
            const minRice = 0;

            const availableGold = Math.max(0, destNation.gold - minGold);
            const availableRice = Math.max(0, destNation.rice - minRice);

            stolenGold = Math.min(stolenGold, availableGold);
            stolenRice = Math.min(stolenRice, availableRice);

            effects.push(
                createNationPatchEffect(
                    {
                        gold: Math.round(destNation.gold - stolenGold),
                        rice: Math.round(destNation.rice - stolenRice),
                    },
                    destNation.id
                )
            );

            effects.push(
                createCityPatchEffect(
                    {
                        // 레거시는 같은 명령 안에서 잠시 34로 쓴 뒤 최종 32로
                        // 덮어쓴다. 관찰 가능한 최종 상태는 32다.
                        state: 32,
                    },
                    args.destCityId
                )
            );
        } else {
            // 레거시는 미보급 도시 자원을 먼저 감소시키지만 같은 명령 끝의
            // 원본 destCity 전체 저장이 이를 덮어쓴다. 관찰 가능한 최종
            // 상태는 자원 변화 없이 state 32만 남는다.
            effects.push(
                createCityPatchEffect(
                    {
                        state: 32,
                    },
                    args.destCityId
                )
            );
        }

        let myShareGold = stolenGold;
        let myShareRice = stolenRice;

        if (nation && nation.id !== 0) {
            const nationShareGold = Math.round(stolenGold * 0.7);
            const nationShareRice = Math.round(stolenRice * 0.7);
            myShareGold -= nationShareGold;
            myShareRice -= nationShareRice;

            effects.push(
                createNationPatchEffect(
                    {
                        gold: nation.gold + nationShareGold,
                        rice: nation.rice + nationShareRice,
                    },
                    nation.id
                )
            );
        }

        const commandName = ACTION_NAME;
        const destCityName = destCity.name;
        ctx.addLog(`<G><b>${destCityName}</b></>에 ${commandName}${JosaUtil.pick(commandName, '이')} 성공했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        ctx.addLog(`금<C>${stolenGold}</> 쌀<C>${stolenRice}</>을 획득했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.PLAIN,
        });

        consumeSuccessfulStrategyItem(this.pipeline, context);
        general.gold = Math.round(general.gold + myShareGold);
        general.rice = Math.round(general.rice + myShareRice);

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, SeizeArgs, GeneralActionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(env: TurnCommandEnv) {
        this.resolver = new ActionResolver<TriggerState>(env);
    }

    parseArgs(raw: unknown): SeizeArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(ctx: ConstraintContext, _args: SeizeArgs): Constraint[] {
        const env = ctx.env;
        const cost = ((env.develCost as number) ?? 100) * 5;
        return [notBeNeutral(), occupiedCity(), suppliedCity(), reqGeneralGold(() => cost), reqGeneralRice(() => cost)];
    }

    buildConstraints(ctx: ConstraintContext, _args: SeizeArgs): Constraint[] {
        const env = ctx.env;
        const cost = ((env.develCost as number) ?? 100) * 5;
        return [
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            notOccupiedDestCity(),
            notNeutralDestCity(),
            reqGeneralGold(() => cost),
            reqGeneralRice(() => cost),
            disallowDiplomacyBetweenStatus({
                7: '불가침국입니다.',
            }),
        ];
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: SeizeArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder = (base: ActionContextBase, options: ActionContextOptions) => {
    const strategyContext = buildStrategyActionContext(base, options);
    if (!strategyContext) return null;
    return {
        ...strategyContext,
        env: options.scenarioConfig.const as unknown as TurnCommandEnv,
        year: options.world.currentYear,
        startYear: options.scenarioMeta?.startYear ?? options.world.currentYear,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_탈취',
    category: '군사',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
