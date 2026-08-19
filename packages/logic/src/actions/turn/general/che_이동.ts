import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    notSameDestCity,
    nearCity,
    reqGeneralGold,
    reqGeneralRice,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
    GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type { MapDefinition } from '@sammo-ts/logic/world/types.js';
import { parseArgsWithSchema } from '../parseArgs.js';
import { formatDestCityConstraintFailure } from '../constraintFailure.js';
import { GeneralActionPipeline } from '@sammo-ts/logic/actionModules/general.js';

export interface MoveResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    moveGenerals?: General<TriggerState>[]; // For roaming move
    map?: MapDefinition; // For connectivity check
    develCost?: number;
}

const ACTION_NAME = '이동';
const ACTION_KEY = 'che_이동';
const ARGS_SCHEMA = z.object({
    destCityId: z.number(),
});
export type MoveArgs = z.infer<typeof ARGS_SCHEMA>;

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, MoveArgs> {
    readonly key = ACTION_KEY;
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(env: TurnCommandEnv) {
        this.pipeline = new GeneralActionPipeline(env.generalActionModules ?? []);
    }

    resolve(context: MoveResolveContext<TriggerState>, args: MoveArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        const { destCityId } = args;

        const effects: GeneralActionEffect<TriggerState>[] = [];

        const isRoamingLeader = general.officerLevel === 12 && nation && nation.level === 0;
        let moveTargets: General<TriggerState>[] = [general];

        if (isRoamingLeader && context.moveGenerals) {
            const others = context.moveGenerals.filter((g) => g.nationId === nation.id && g.id !== general.id);
            moveTargets = [general, ...others];
        }

        const cost = context.develCost ?? 0;

        const destCityName =
            context.map?.cities.find((city) => city.id === destCityId)?.name ?? '알 수 없는 도시';

        const josaRo = JosaUtil.pick(destCityName, '로');

        context.addLog(`<G><b>${destCityName}</b></>${josaRo} 이동했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        for (const target of moveTargets) {
            const isSelf = target.id === general.id;

            let nextGold = target.gold;
            let nextAtmos = target.atmos;
            let nextExp = target.experience;
            const nextDed = target.dedication;
            let nextLeadershipExp = typeof target.meta.leadership_exp === 'number' ? target.meta.leadership_exp : 0;

            if (isSelf) {
                nextGold = Math.max(0, nextGold - cost);
                nextAtmos = Math.max(20, nextAtmos - 5);
                nextExp += this.pipeline.onCalcStat(context, 'experience', 50);
                nextLeadershipExp += 1;
            }

            effects.push(
                createGeneralPatchEffect(
                    {
                        ...target,
                        cityId: destCityId,
                        gold: nextGold,
                        atmos: nextAtmos,
                        experience: nextExp,
                        dedication: nextDed,
                        meta: {
                            ...target.meta,
                            leadership_exp: nextLeadershipExp,
                        },
                    },
                    target.id
                )
            );
        }

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, MoveArgs, MoveResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(env: TurnCommandEnv) {
        this.resolver = new ActionResolver(env);
    }

    parseArgs(raw: unknown): MoveArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(ctx: ConstraintContext, _args: MoveArgs): Constraint[] {
        return [
            reqGeneralGold(() => {
                const develCost = ctx.env.develCost as number;
                return develCost ?? 0;
            }),
            reqGeneralRice(() => 0),
        ];
    }

    buildConstraints(ctx: ConstraintContext, _args: MoveArgs): Constraint[] {
        return [
            notSameDestCity(),
            nearCity(1),
            reqGeneralGold(() => {
                const develCost = ctx.env.develCost as number;
                return develCost ?? 0;
            }),
            reqGeneralRice(() => 0),
        ];
    }

    formatConstraintFailure(
        reason: string,
        _ctx: ConstraintContext,
        args: MoveArgs,
        view: StateView
    ): string | null {
        return formatDestCityConstraintFailure(reason, this.name, args.destCityId, view, 'direction');
    }

    resolve(context: MoveResolveContext<TriggerState>, args: MoveArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    return {
        ...base,
        map: options.map,
        develCost:
            typeof options.world.meta?.develcost === 'number'
                ? options.world.meta.develcost
                : (options.scenarioConfig.const.develCost as number | undefined),
        moveGenerals: options.worldRef?.listGenerals() ?? [],
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_이동',
    category: '군사',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
