import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    denyWithReason,
    existsDestGeneral,
    friendlyDestGeneral,
    notBeNeutral,
    occupiedCity,
    reqGeneralGold,
    reqGeneralRice,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';
import { normalizeResourceActionAmount } from '../resourceAmount.js';

const ACTION_NAME = '증여';
const ACTION_KEY = 'che_증여';
const ARGS_SCHEMA = z.object({
    isGold: z.boolean(),
    amount: z.number(),
    destGeneralID: z.number().int().positive(),
});
export type GiftArgs = z.infer<typeof ARGS_SCHEMA>;

export interface GiftResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destGeneral?: General<TriggerState>;
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, GiftArgs, GiftResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;

    constructor(private readonly env: TurnCommandEnv) {}

    parseArgs(raw: unknown): GiftArgs | null {
        const parsed = parseArgsWithSchema(ARGS_SCHEMA, raw);
        if (!parsed) {
            return null;
        }
        const amount = normalizeResourceActionAmount(parsed.amount, this.env.maxResourceActionAmount);
        if (amount === null) {
            return null;
        }
        return {
            ...parsed,
            amount,
        };
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: GiftArgs): Constraint[] {
        return [notBeNeutral(), occupiedCity(), suppliedCity()];
    }

    buildConstraints(ctx: ConstraintContext, args: GiftArgs): Constraint[] {
        if (ctx.actorId === args.destGeneralID) {
            return [denyWithReason('본인입니다')];
        }
        const minGold = this.env.generalMinimumGold ?? 0;
        const minRice = this.env.generalMinimumRice ?? 500;

        return [
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            existsDestGeneral(),
            friendlyDestGeneral(),
            args.isGold ? reqGeneralGold(() => minGold) : reqGeneralRice(() => minRice),
        ];
    }

    resolve(context: GiftResolveContext<TriggerState>, args: GiftArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const destGeneral = context.destGeneral;
        if (!destGeneral) {
            throw new Error('증여 대상 장수가 없습니다.');
        }

        const minGold = this.env.generalMinimumGold ?? 0;
        const minRice = this.env.generalMinimumRice ?? 500;

        const resKey = args.isGold ? 'gold' : 'rice';
        const resName = args.isGold ? '금' : '쌀';
        const keepMin = args.isGold ? minGold : minRice;

        const available = Math.max(0, general[resKey] - keepMin);
        const amount = Math.max(0, Math.min(args.amount, available));
        const amountText = amount.toLocaleString('en-US');

        const leadershipExp = typeof general.meta.leadership_exp === 'number' ? general.meta.leadership_exp : 0;

        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        return {
            effects: [
                createGeneralPatchEffect<TriggerState>(
                    {
                        [resKey]: general[resKey] - amount,
                        experience: general.experience + 70,
                        dedication: general.dedication + 100,
                        meta: {
                            ...general.meta,
                            leadership_exp: leadershipExp + 1,
                        },
                    },
                    general.id
                ),
                createGeneralPatchEffect<TriggerState>(
                    {
                        [resKey]: destGeneral[resKey] + amount,
                    },
                    destGeneral.id
                ),
                createLogEffect(`<Y>${general.name}</>에게서 ${resName} <C>${amountText}</>을 증여 받았습니다.`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: destGeneral.id,
                    format: LogFormat.PLAIN,
                    legacyFlushGroup: 1,
                }),
                createLogEffect(`<Y>${destGeneral.name}</>에게 ${resName} <C>${amountText}</>을 증여했습니다.`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }),
            ],
        };
    }
}

export const actionContextBuilder: ActionContextBuilder<GiftArgs> = (base, options) => {
    const destGeneralID = options.actionArgs.destGeneralID;
    if (typeof destGeneralID !== 'number') {
        return null;
    }
    const destGeneral = options.worldRef?.getGeneralById(destGeneralID) ?? undefined;
    if (!destGeneral) {
        return null;
    }

    return {
        ...base,
        destGeneral,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: ACTION_KEY,
    category: '국가',
    reqArg: true,
    availabilityArgs: {
        isGold: false,
        amount: 0,
        destGeneralID: 0,
    },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
