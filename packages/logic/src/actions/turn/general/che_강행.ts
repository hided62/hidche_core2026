import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import { notSameDestCity, nearCity, reqGeneralGold, reqGeneralRice } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
    GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type { MapDefinition } from '@sammo-ts/logic/world/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { normalizeLegacyIntegerArg, parseArgsWithSchema } from '../parseArgs.js';
import { formatDestCityConstraintFailure } from '../constraintFailure.js';

export interface ForcedMoveResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    moveGenerals?: General<TriggerState>[]; // For roaming move
    map?: MapDefinition;
    startDevelCost?: number;
}

const ACTION_NAME = '강행';
const ACTION_KEY = 'che_강행';
const ARGS_SCHEMA = z.object({
    destCityId: z.preprocess(normalizeLegacyIntegerArg, z.number().int()),
});
export type ForcedMoveArgs = z.infer<typeof ARGS_SCHEMA>;

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, ForcedMoveArgs> {
    readonly key = ACTION_KEY;

    resolve(context: ForcedMoveResolveContext<TriggerState>, args: ForcedMoveArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        const { destCityId } = args;

        const effects: GeneralActionEffect<TriggerState>[] = [];

        // Determine if roaming leader logic applies
        // Legacy: if ($general->getVar('officer_level') == 12 && $this->nation['level'] == 0)
        // Roaming nation leader moving -> moves everyone in nation that isn't self (handled in legacy by finding generals)
        // Actually legacy loop: SELECT no FROM general WHERE nation=%i AND no!=%i

        const isRoamingLeader = general.officerLevel === 12 && nation && nation.level === 0;
        let moveTargets: General<TriggerState>[] = [general];

        if (isRoamingLeader && context.moveGenerals) {
            const others = context.moveGenerals.filter((g) => g.nationId === nation.id && g.id !== general.id);
            // Legacy updates DB directly for others, and logs for them.
            // Here we queue patch effects for everyone.
            moveTargets = [general, ...others]; // Self first
        }

        // Cost calculation
        // Legacy: env['develcost'] * 5 gold.
        const develCost = context.startDevelCost ?? 0;
        const goldCost = develCost * 5;

        // Log destination
        const destCityName =
            context.map?.cities.find((city) => city.id === destCityId)?.name ?? '알 수 없는 도시';

        const josaRo = JosaUtil.pick(destCityName, '로');

        // Log for self: "<G><b>{$destCityName}</b></>{$josaRo} 강행했습니다. <1>$date</>"
        context.addLog(`<G><b>${destCityName}</b></>${josaRo} 강행했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        // Effects for self:
        // city = dest
        // gold -= cost (limit 0)
        // train -= 5 (limit 20)
        // atmos -= 5 (limit 20)
        // exp += 100
        // leadership_exp += 1

        const nextGold = Math.max(0, general.gold - goldCost);
        const nextTrain = Math.max(20, general.train - 5);
        const nextAtmos = Math.max(20, general.atmos - 5);
        const nextExp = general.experience + 100;
        const nextLeadershipExp =
            (typeof general.meta.leadership_exp === 'number' ? general.meta.leadership_exp : 0) + 1;

        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        effects.push(
            createGeneralPatchEffect(
                {
                    ...general,
                    cityId: destCityId,
                    gold: nextGold,
                    train: nextTrain,
                    atmos: nextAtmos,
                    experience: nextExp,
                    meta: {
                        ...general.meta,
                        leadership_exp: nextLeadershipExp,
                    },
                },
                general.id
            )
        );

        // Effects/Logs for subordinates (if roaming leader)
        if (isRoamingLeader && moveTargets.length > 1) {
            for (const target of moveTargets) {
                if (target.id === general.id) continue;
                effects.push(
                    createGeneralPatchEffect(
                        {
                            ...target,
                            cityId: destCityId,
                        },
                        target.id
                    ),
                    createLogEffect(`방랑군 세력이 <G><b>${destCityName}</b></>${josaRo} 강행했습니다.`, {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        format: LogFormat.PLAIN,
                        generalId: target.id,
                        legacyFlushGroup: -1,
                    })
                );
            }
        }

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, ForcedMoveArgs, ForcedMoveResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor() {
        this.resolver = new ActionResolver();
    }

    parseArgs(raw: unknown): ForcedMoveArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: ForcedMoveArgs): Constraint[] {
        return [];
    }

    buildConstraints(ctx: ConstraintContext, _args: ForcedMoveArgs): Constraint[] {
        return [
            notSameDestCity(),
            nearCity(3),
            reqGeneralGold((_c, _v) => {
                const cost = ctx.env.develCost as number;
                return (cost ?? 0) * 5;
            }),
            reqGeneralRice(() => 0), // Legacy checks cost[1] which is 0, but included constraint.
        ];
    }

    formatConstraintFailure(
        reason: string,
        _ctx: ConstraintContext,
        args: ForcedMoveArgs,
        view: StateView
    ): string | null {
        return formatDestCityConstraintFailure(reason, this.name, args.destCityId, view, 'direction');
    }

    resolve(context: ForcedMoveResolveContext<TriggerState>, args: ForcedMoveArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const rawCost = options.scenarioConfig.const.develCost ?? options.scenarioConfig.const.develcost;
    return {
        ...base,
        moveGenerals: options.worldRef?.listGenerals() ?? [],
        map: options.map,
        startDevelCost: typeof rawCost === 'number' ? rawCost : 0,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_강행',
    category: '군사',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
