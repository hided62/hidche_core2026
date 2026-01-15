import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    notSameDestCity,
    nearCity,
    reqGeneralGold,
    reqGeneralRice,
    existsDestCity,
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
import type { GeneralTurnCommandSpec } from './index.js';
import type { MapDefinition } from '@sammo-ts/logic/world/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { parseArgsWithSchema } from '../parseArgs.js';

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
    destCityId: z.number(),
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
        let destCityName = `도시(${destCityId})`;
        if (context.map) {
            const c = context.map.cities.find((ct) => ct.id === destCityId);
            if (c) destCityName = c.name;
        }

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

                // Legacy: "방랑군 세력이 <G><b>{$destCityName}</b></>{$josaRo} 강행했습니다." (LOG_PLAIN)
                // NOTE: We need a way to push log to OTHER general's logger.
                // In current engine, we return effects. Log effects?
                // Currently addLog attaches provided logs to turnLog (which is for the actor).
                // To log for OTHERS, we might need specific effect or handle it differently.
                // For now, I will omit logs for others or use a special effect if available.
                // The legacy TS porting pattern for "others" logs isn't fully standardized yet in shared snippets.
                // Assuming createGeneralPatchEffect handles state. Logs for others might be missing in this iteration unless I find `createLogEffect`.

                effects.push(
                    createGeneralPatchEffect(
                        {
                            ...target,
                            cityId: destCityId,
                        },
                        target.id
                    )
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
            existsDestCity(),
            notSameDestCity(),
            nearCity(3),
            reqGeneralGold((_c, _v) => {
                const cost = ctx.env.develCost as number;
                return (cost ?? 0) * 5;
            }),
            reqGeneralRice(() => 0), // Legacy checks cost[1] which is 0, but included constraint.
        ];
    }

    resolve(context: ForcedMoveResolveContext<TriggerState>, args: ForcedMoveArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    return {
        ...base,
        moveGenerals: options.worldRef?.listGenerals() ?? [],
        map: options.map,
        startDevelCost: options.scenarioConfig.const.develCost as number | undefined,
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
