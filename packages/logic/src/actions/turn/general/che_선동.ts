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
import { createGeneralPatchEffect, createCityPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBase, ActionContextOptions } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { JosaUtil } from '@sammo-ts/common';
import { parseArgsWithSchema } from '../parseArgs.js';
import { GeneralActionPipeline } from '@sammo-ts/logic/triggers/general-action.js';
import { consumeSuccessfulStrategyItem } from './strategyItemConsumption.js';
import {
    buildStrategyActionContext,
    CommandResolver as StrategyCommandResolver,
    type FireAttackResolveContext,
} from './che_화계.js';

export interface AgitateResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends FireAttackResolveContext<TriggerState> {
    env?: TurnCommandEnv;
}

const ACTION_NAME = '선동';
const ACTION_KEY = 'che_선동';
const ARGS_SCHEMA = z.object({
    destCityId: z.number(),
});
export type AgitateArgs = z.infer<typeof ARGS_SCHEMA>;

// 레거시 city.trust는 MariaDB FLOAT이며 다음 명령에서 6자리 유효숫자로
// 재조회된다. 메모리 상태도 같은 persistence 경계로 정규화한다.
const toLegacyStoredTrust = (value: number): number => Number(value.toPrecision(6));

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, AgitateArgs> {
    readonly key = ACTION_KEY;
    private readonly pipeline: GeneralActionPipeline<TriggerState>;
    private readonly command: StrategyCommandResolver<TriggerState>;

    constructor(env: TurnCommandEnv) {
        const modules = env.generalActionModules ?? [];
        this.pipeline = new GeneralActionPipeline(modules);
        this.command = new StrategyCommandResolver<TriggerState>(modules, {
            ...env,
            statKey: 'leadership',
            damageMode: 'agitate',
        });
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: AgitateArgs): GeneralActionOutcome<TriggerState> {
        const ctx = context as AgitateResolveContext<TriggerState>;
        const general = ctx.general;
        const destCity = ctx.destCity;
        if (!destCity) throw new Error('Target city missing');
        const effects: GeneralActionEffect<TriggerState>[] = [];
        const city = ctx.city;
        if (!city) throw new Error('Source city missing');
        const result = this.command.resolve(
            {
                ...ctx,
                city,
                destCity,
                destGenerals: ctx.destGenerals,
            },
            ctx.rng
        );
        general.gold = Math.max(0, general.gold - result.costGold);
        general.rice = Math.max(0, general.rice - result.costRice);
        general.experience += result.exp;
        general.dedication += result.dedication;
        general.meta.leadership_exp =
            (typeof general.meta.leadership_exp === 'number' ? general.meta.leadership_exp : 0) + 1;
        if (!result.success) {
            ctx.addLog(
                `<G><b>${destCity.name}</b></>에 ${ACTION_NAME}${JosaUtil.pick(ACTION_NAME, '이')} 실패했습니다.`
            );
            return { effects };
        }
        general.meta.firenum = (typeof general.meta.firenum === 'number' ? general.meta.firenum : 0) + 1;
        const newSecu = Math.max(0, destCity.security - result.agriDamage);
        const currentTrust = typeof destCity.meta.trust === 'number' ? destCity.meta.trust : 50;
        const newTrust = toLegacyStoredTrust(Math.max(0, currentTrust - result.commDamage));

        // Log
        const commandName = ACTION_NAME;
        const destCityName = destCity.name;
        ctx.addLog(`<G><b>${destCityName}</b></>에 ${commandName}${JosaUtil.pick(commandName, '이')} 성공했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        ctx.addLog(
            `도시의 치안이 <C>${result.agriDamage}</>, 민심이 <C>${result.commDamage.toFixed(
                1
            )}</>만큼 감소하고, 장수 <C>${result.injuryCount}</>명이 부상 당했습니다.`,
            {
                category: LogCategory.ACTION,
                format: LogFormat.PLAIN,
            }
        );

        // City Update
        effects.push(
            createCityPatchEffect(
                {
                    security: newSecu,
                    state: 32,
                    meta: {
                        ...destCity.meta,
                        trust: newTrust,
                    },
                },
                args.destCityId
            )
        );

        consumeSuccessfulStrategyItem(this.pipeline, context);
        for (const injured of result.injuredGenerals) {
            effects.push(createGeneralPatchEffect(injured.patch, injured.id));
        }

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, AgitateArgs, GeneralActionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(env: TurnCommandEnv) {
        this.resolver = new ActionResolver<TriggerState>(env);
    }

    parseArgs(raw: unknown): AgitateArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(ctx: ConstraintContext, _args: AgitateArgs): Constraint[] {
        const env = ctx.env;
        const cost = ((env.develCost as number) ?? 100) * 5;
        return [notBeNeutral(), occupiedCity(), suppliedCity(), reqGeneralGold(() => cost), reqGeneralRice(() => cost)];
    }

    buildConstraints(ctx: ConstraintContext, _args: AgitateArgs): Constraint[] {
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

    resolve(context: GeneralActionResolveContext<TriggerState>, args: AgitateArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder = (base: ActionContextBase, options: ActionContextOptions) => {
    const strategyContext = buildStrategyActionContext(base, options);
    if (!strategyContext) return null;
    return {
        ...strategyContext,
        env: options.scenarioConfig.const as unknown as TurnCommandEnv,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_선동',
    category: '군사',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
