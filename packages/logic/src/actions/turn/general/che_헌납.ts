import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    reqGeneralGold,
    reqGeneralRice,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface DonateArgs {
    isGold: boolean;
    amount: number;
}

const ACTION_NAME = '헌납';
const ACTION_KEY = 'che_헌납';

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

        // Exp/Ded calculation
        const exp = Math.floor(realAmount / 100);
        const ded = Math.floor(realAmount / 50);

        const amountText = realAmount.toLocaleString();
        context.addLog(`${resName} <C>${amountText}</>을 헌납했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        return {
            effects: [
                createGeneralPatchEffect(
                    {
                        ...general,
                        [resKey]: currentRes - realAmount,
                        experience: general.experience + exp,
                        dedication: general.dedication + ded,
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
        const data = raw as Partial<DonateArgs>;
        if (typeof data.isGold !== 'boolean' || typeof data.amount !== 'number') return null;
        return { isGold: data.isGold, amount: data.amount };
    }

    buildConstraints(_ctx: ConstraintContext, args: DonateArgs): Constraint[] {
        if (args.isGold) {
            return [notBeNeutral(), notWanderingNation(), reqGeneralGold(() => args.amount)];
        }
        return [notBeNeutral(), notWanderingNation(), reqGeneralRice(() => args.amount)];
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
    args: { isGold: true, amount: 0 },
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
