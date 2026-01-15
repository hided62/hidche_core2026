import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    beChief,
    existsDestGeneral,
    friendlyDestGeneral,
    notBeNeutral,
    notOpeningPart,
    occupiedCity,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { createLogEffect, createNationPatchEffect, createGeneralPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { clamp } from 'es-toolkit';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    isGold: z.boolean(),
    amount: z.preprocess(
        (value) => (typeof value === 'number' ? Math.floor(value / 100) * 100 : value),
        z.number().int().positive()
    ),
    destGeneralID: z.number(),
});
export type SeizureArgs = z.infer<typeof ARGS_SCHEMA>;

export interface SeizureResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destGeneral: General<TriggerState>;
}

const ACTION_NAME = '몰수';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, SeizureArgs, SeizureResolveContext<TriggerState>> {
    public readonly key = 'che_몰수';
    public readonly name = ACTION_NAME;

    constructor(private readonly env: TurnCommandEnv) {}

    parseArgs(raw: unknown): SeizureArgs | null {
        const data = parseArgsWithSchema(ARGS_SCHEMA, raw);
        if (!data) {
            return null;
        }
        return {
            ...data,
            amount: clamp(data.amount, 100, this.env.maxResourceActionAmount ?? 10000),
        };
    }

    buildMinConstraints(ctx: ConstraintContext, _args: SeizureArgs): Constraint[] {
        const relYear = typeof ctx.env.relYear === 'number' ? ctx.env.relYear : 0;
        const openingPartYear = typeof ctx.env.openingPartYear === 'number' ? ctx.env.openingPartYear : 0;
        return [notBeNeutral(), occupiedCity(), beChief(), notOpeningPart(relYear, openingPartYear), suppliedCity()];
    }

    buildConstraints(_ctx: ConstraintContext, args: SeizureArgs): Constraint[] {
        const relYear = typeof _ctx.env.relYear === 'number' ? _ctx.env.relYear : 0;
        const openingPartYear = typeof _ctx.env.openingPartYear === 'number' ? _ctx.env.openingPartYear : 0;
        return [
            notBeNeutral(),
            occupiedCity(),
            beChief(),
            notOpeningPart(relYear, openingPartYear),
            suppliedCity(),
            existsDestGeneral(),
            friendlyDestGeneral(),
            {
                name: 'notSelf',
                requires: () => [],
                test: (ctx: ConstraintContext) => {
                    if (ctx.actorId === args.destGeneralID) {
                        return { kind: 'deny', reason: '본인입니다' };
                    }
                    return { kind: 'allow' };
                },
            },
        ];
    }

    resolve(context: SeizureResolveContext<TriggerState>, args: SeizureArgs): GeneralActionOutcome<TriggerState> {
        const { general, nation, destGeneral } = context;
        if (!nation) {
            return { effects: [createLogEffect('국가 정보가 없습니다.', { scope: LogScope.GENERAL })] };
        }

        const resKey = args.isGold ? 'gold' : 'rice';
        const resName = args.isGold ? '금' : '쌀';

        const actualAmount = clamp(args.amount, 0, destGeneral[resKey] ?? 0);

        if (actualAmount <= 0) {
            return {
                effects: [
                    createLogEffect(`${destGeneral.name}에게서 몰수할 ${resName}이 없습니다.`, {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        format: LogFormat.MONTH,
                    }),
                ],
            };
        }

        const amountText = actualAmount.toLocaleString();
        const josaUl = JosaUtil.pick(amountText, '을');

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createGeneralPatchEffect(
                {
                    [resKey]: destGeneral[resKey] - actualAmount,
                },
                destGeneral.id
            ),
            createNationPatchEffect(
                {
                    [resKey]: nation[resKey] + actualAmount,
                },
                nation.id
            ),
            // Actor General Action Log
            createLogEffect(`<Y>${destGeneral.name}</>에게서 ${resName} <C>${amountText}</>${josaUl} 몰수했습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            }),
            // Target General Action Log
            createLogEffect(`${resName} ${amountText}${josaUl} 몰수 당했습니다.`, {
                scope: LogScope.GENERAL,
                generalId: destGeneral.id,
                category: LogCategory.ACTION,
                format: LogFormat.PLAIN,
            }),
        ];

        general.experience += 5;
        general.dedication += 5;

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder<SeizureArgs> = (base, options) => {
    const destGeneralId = options.actionArgs.destGeneralID;
    if (typeof destGeneralId !== 'number') return null;

    const worldRef = options.worldRef;
    if (!worldRef) return null;

    const destGeneral = worldRef.getGeneralById(destGeneralId);
    if (!destGeneral) return null;

    return {
        ...base,
        destGeneral,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_몰수',
    category: '인사',
    reqArg: true,
    availabilityArgs: { isGold: false, amount: 0, destGeneralID: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
