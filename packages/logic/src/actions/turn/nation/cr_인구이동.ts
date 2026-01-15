import type { City, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    beChief,
    nearCity,
    notSameDestCity,
    occupiedCity,
    occupiedDestCity,
    reqCityCapacity,
    reqNationGold,
    reqNationRice,
    suppliedCity,
    suppliedDestCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { createCityPatchEffect, createLogEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { clamp } from 'es-toolkit';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

export interface PopulationMoveResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity: City;
    destNation: Nation | null;
}

const ACTION_NAME = '인구이동';
const AMOUNT_LIMIT = 100000;
const MIN_AVAILABLE_RECRUIT_POP = 30000;

const ARGS_SCHEMA = z.object({
    destCityId: z.preprocess(
        (value) => (typeof value === 'number' ? Math.floor(value) : value),
        z.number().int().positive()
    ),
    amount: z.preprocess(
        (value) => (typeof value === 'number' ? clamp(Math.floor(value), 0, AMOUNT_LIMIT) : value),
        z.number().int().min(0).max(AMOUNT_LIMIT)
    ),
});
export type PopulationMoveArgs = z.infer<typeof ARGS_SCHEMA>;

const calcCost = (develCost: number, amount: number): number => Math.round((develCost * amount) / 10000);

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, PopulationMoveArgs, PopulationMoveResolveContext<TriggerState>> {
    public readonly key = 'cr_인구이동';
    public readonly name = ACTION_NAME;

    constructor(private readonly env: TurnCommandEnv) {}

    parseArgs(raw: unknown): PopulationMoveArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: PopulationMoveArgs): Constraint[] {
        return [
            occupiedCity(),
            beChief(),
            suppliedCity(),
            reqCityCapacity('population', '주민', MIN_AVAILABLE_RECRUIT_POP + 100),
        ];
    }

    buildConstraints(_ctx: ConstraintContext, args: PopulationMoveArgs): Constraint[] {
        const cost = calcCost(this.env.develCost, args.amount);
        return [
            notSameDestCity(),
            occupiedCity(),
            reqCityCapacity('population', '주민', MIN_AVAILABLE_RECRUIT_POP + 100),
            occupiedDestCity(),
            nearCity(1),
            beChief(),
            suppliedCity(),
            suppliedDestCity(),
            reqNationGold(() => this.env.baseGold + cost),
            reqNationRice(() => this.env.baseRice + cost),
        ];
    }

    resolve(
        context: PopulationMoveResolveContext<TriggerState>,
        args: PopulationMoveArgs
    ): GeneralActionOutcome<TriggerState> {
        const { general, nation, city, destCity } = context;
        if (!nation || !city) {
            return { effects: [createLogEffect('국가 정보가 없습니다.', { scope: LogScope.GENERAL })] };
        }

        const available = Math.max(0, city.population - MIN_AVAILABLE_RECRUIT_POP);
        const amount = clamp(args.amount, 0, available);
        if (amount <= 0) {
            return {
                effects: [
                    createLogEffect('이동할 인구가 부족합니다.', {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        format: LogFormat.MONTH,
                    }),
                ],
            };
        }

        const cost = calcCost(this.env.develCost, amount);
        const amountText = amount.toLocaleString();
        const destCityName = destCity.name;
        const josaRo = JosaUtil.pick(destCityName, '로');

        general.experience += 5;
        general.dedication += 5;

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createCityPatchEffect(
                {
                    population: destCity.population + amount,
                },
                destCity.id
            ),
            createCityPatchEffect(
                {
                    population: city.population - amount,
                },
                city.id
            ),
            createNationPatchEffect(
                {
                    gold: nation.gold - cost,
                    rice: nation.rice - cost,
                },
                nation.id
            ),
            createLogEffect(`<G><b>${destCityName}</b></>${josaRo} 인구 <C>${amountText}</>명을 옮겼습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            }),
        ];

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder<PopulationMoveArgs> = (base, options) => {
    const destCityId = options.actionArgs.destCityId;
    if (typeof destCityId !== 'number') {
        return null;
    }
    const worldRef = options.worldRef;
    if (!worldRef) {
        return null;
    }
    const destCity = worldRef.getCityById(destCityId);
    if (!destCity) {
        return null;
    }
    const destNation = worldRef.getNationById(destCity.nationId);
    return {
        ...base,
        destCity,
        destNation: destNation ?? null,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'cr_인구이동',
    category: '특수',
    reqArg: true,
    availabilityArgs: { destCityId: 0, amount: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
