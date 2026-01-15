import type { City, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notOccupiedDestCity,
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
import {
    createGeneralPatchEffect,
    createCityPatchEffect,
    createNationPatchEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBase, ActionContextOptions } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { JosaUtil } from '@sammo-ts/common';
import { parseArgsWithSchema } from '../parseArgs.js';

export interface SeizeResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity?: City;
    destNation?: Nation | null;
    env?: TurnCommandEnv;
    year?: number;
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

    resolve(context: GeneralActionResolveContext<TriggerState>, args: SeizeArgs): GeneralActionOutcome<TriggerState> {
        const ctx = context as SeizeResolveContext<TriggerState>;
        const general = ctx.general;
        const nation = ctx.nation; // Own nation
        const { destCityId } = args;
        const destCity = ctx.destCity;
        const destNation = ctx.destNation;

        if (!destCity) throw new Error('Target city missing');

        const env = ctx.env;
        const cost = env?.develCost ?? 100;

        const effects: GeneralActionEffect<TriggerState>[] = [];

        // Calculation
        const min = env?.sabotageDamageMin ?? 10;
        const max = env?.sabotageDamageMax ?? 30;
        const rng = ctx.rng;
        if (!rng) throw new Error('RNG missing');

        const currentYear = ctx.year ?? 200;
        const startYear = env?.openingPartYear ?? currentYear;
        const yearCoef = Math.sqrt(1 + Math.max(0, currentYear - startYear) / 4) / 2;

        const commRatio = destCity.commerce / destCity.commerceMax;
        const agriRatio = destCity.agriculture / destCity.agricultureMax;

        const rawGold = rng.nextInt(min, max + 1) * destCity.level * yearCoef * (0.25 + commRatio / 4);
        const rawRice = rng.nextInt(min, max + 1) * destCity.level * yearCoef * (0.25 + agriRatio / 4);

        let stolenGold = Math.floor(rawGold);
        let stolenRice = Math.floor(rawRice);

        const isSupplied = destCity.supplyState === 1;

        if (isSupplied && destNation) {
            const minGold = 1000;
            const minRice = 1000;

            const availableGold = Math.max(0, destNation.gold - minGold);
            const availableRice = Math.max(0, destNation.rice - minRice);

            stolenGold = Math.min(stolenGold, availableGold);
            stolenRice = Math.min(stolenRice, availableRice);

            effects.push(
                createNationPatchEffect(
                    {
                        ...destNation,
                        gold: destNation.gold - stolenGold,
                        rice: destNation.rice - stolenRice,
                    },
                    destNation.id
                )
            );

            effects.push(
                createCityPatchEffect(
                    {
                        ...destCity,
                        state: 34,
                    },
                    destCityId
                )
            );
        } else {
            const commDmg = Math.floor(stolenGold / 12);
            const agriDmg = Math.floor(stolenRice / 12);

            effects.push(
                createCityPatchEffect(
                    {
                        ...destCity,
                        commerce: Math.max(0, destCity.commerce - commDmg),
                        agriculture: Math.max(0, destCity.agriculture - agriDmg),
                        state: 34,
                    },
                    destCityId
                )
            );
        }

        let myShareGold = stolenGold;
        let myShareRice = stolenRice;

        if (nation && nation.id !== 0) {
            const nationShareGold = Math.floor(stolenGold * 0.7);
            const nationShareRice = Math.floor(stolenRice * 0.7);
            myShareGold -= nationShareGold;
            myShareRice -= nationShareRice;

            effects.push(
                createNationPatchEffect(
                    {
                        ...nation,
                        gold: nation.gold + nationShareGold,
                        rice: nation.rice + nationShareRice,
                    },
                    nation.id
                )
            );
        }

        const destCityName = destCity.name;
        ctx.addLog(`<G>${destCityName}</>에 ${ACTION_NAME}${JosaUtil.pick(ACTION_NAME, '이')} 성공했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        ctx.addLog(`금 ${stolenGold}, 쌀 ${stolenRice} 을 획득했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        effects.push(
            createGeneralPatchEffect(
                {
                    ...general,
                    gold: Math.max(0, general.gold - cost + myShareGold),
                    rice: Math.max(0, general.rice - cost + myShareRice),
                    experience: general.experience + 50,
                    dedication: general.dedication + 30,
                    meta: {
                        ...general.meta,
                        strength_exp:
                            (typeof general.meta.strength_exp === 'number' ? general.meta.strength_exp : 0) + 1,
                    },
                },
                general.id
            )
        );

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, SeizeArgs, GeneralActionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(_env: TurnCommandEnv) {
        this.resolver = new ActionResolver();
    }

    parseArgs(raw: unknown): SeizeArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildConstraints(ctx: ConstraintContext, _args: SeizeArgs): Constraint[] {
        const env = ctx.env;
        const cost = (env.develCost as number) ?? 100;
        return [
            notBeNeutral(),
            existsDestCity(),
            reqGeneralGold(() => cost),
            reqGeneralRice(() => cost),
            notOccupiedDestCity(),
        ];
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: SeizeArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder = (base: ActionContextBase, options: ActionContextOptions) => {
    const destCityId = options.actionArgs?.destCityId;
    let destCity = null;
    let destNation = null;
    if (typeof destCityId === 'number' && options.worldRef) {
        destCity = options.worldRef.getCityById(destCityId);
        if (destCity && destCity.nationId) {
            destNation = options.worldRef.getNationById(destCity.nationId);
        }
    }
    return {
        ...base,
        destCity,
        destNation,
        env: options.scenarioConfig.const as unknown as TurnCommandEnv,
        year: options.world.currentYear,
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
