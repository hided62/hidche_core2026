import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    occupiedCity,
    reqGeneralGold,
    reqGeneralRice,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';

const ACTION_NAME = '헌납';
const ACTION_KEY = 'che_헌납';
const ARGS_SCHEMA = z.object({
    isGold: z.boolean(),
    amount: z.number(),
});
export type DonateArgs = z.infer<typeof ARGS_SCHEMA>;

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, DonateArgs> {
    readonly key = ACTION_KEY;

    resolve(context: GeneralActionResolveContext<TriggerState>, args: DonateArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        const { isGold, amount } = args;

        if (!nation) {
            throw new Error('Donate requires a nation context.');
        }

        const resKey = isGold ? 'gold' : 'rice';
        const resName = isGold ? '금' : '쌀';
        const currentRes = general[resKey] ?? 0;

        const realAmount = Math.max(0, Math.min(amount, currentRes));

        const exp = 70;
        const ded = 100;

        const amountText = realAmount.toLocaleString();
        context.addLog(`${resName} <C>${amountText}</>을 헌납했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        return {
            effects: [
                createGeneralPatchEffect(
                    {
                        ...general,
                        [resKey]: currentRes - realAmount,
                        experience: general.experience + exp,
                        dedication: general.dedication + ded,
                        meta: {
                            ...general.meta,
                            leadership_exp:
                                (typeof general.meta.leadership_exp === 'number' ? general.meta.leadership_exp : 0) + 1,
                        },
                    },
                    general.id
                ),
                createNationPatchEffect(
                    {
                        ...nation,
                        [resKey]: (nation[resKey] ?? 0) + realAmount,
                    },
                    nation.id
                ),
            ],
        };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, DonateArgs, GeneralActionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor() {
        this.resolver = new ActionResolver();
    }

    parseArgs(raw: unknown): DonateArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: DonateArgs): Constraint[] {
        return [notBeNeutral(), occupiedCity(), suppliedCity()];
    }

    buildConstraints(_ctx: ConstraintContext, args: DonateArgs): Constraint[] {
        if (args.isGold) {
            return [notBeNeutral(), occupiedCity(), suppliedCity(), reqGeneralGold(() => args.amount)];
        }
        return [notBeNeutral(), occupiedCity(), suppliedCity(), reqGeneralRice(() => args.amount)];
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: DonateArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_헌납',
    category: '내정',
    reqArg: true,
    availabilityArgs: { isGold: true, amount: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
