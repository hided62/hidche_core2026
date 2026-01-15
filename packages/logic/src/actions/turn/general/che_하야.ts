import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { notBeNeutral } from '@sammo-ts/logic/constraints/presets.js';
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

export interface ResignArgs {}

const ACTION_NAME = '하야';
const ACTION_KEY = 'che_하야';

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, ResignArgs> {
    readonly key = ACTION_KEY;

    resolve(context: GeneralActionResolveContext<TriggerState>, _args: ResignArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;

        if (!nation) {
            throw new Error('Resign requires a nation context.');
        }

        const effects = [];

        // Return resources
        const maxKeepGold = 1000;
        const maxKeepRice = 1000;

        const newGold = Math.min(general.gold, maxKeepGold);
        const newRice = Math.min(general.rice, maxKeepRice);

        const returnedGold = general.gold - newGold;
        const returnedRice = general.rice - newRice;

        if (returnedGold > 0 || returnedRice > 0) {
            effects.push(
                createNationPatchEffect(
                    {
                        ...nation,
                        gold: nation.gold + returnedGold,
                        rice: nation.rice + returnedRice,
                    },
                    nation.id
                )
            );
        }

        // Penalty
        const betrayal = (general.meta.betrayal as number) ?? 0;
        const penaltyRatio = 0.1 + betrayal * 0.05;
        const nextExp = Math.floor(general.experience * (1 - penaltyRatio));
        const nextDed = Math.floor(general.dedication * (1 - penaltyRatio));

        context.addLog(`하야하여 재야로 돌아갑니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        effects.push(
            createGeneralPatchEffect(
                {
                    ...general,
                    nationId: 0,
                    officerLevel: 0,
                    gold: newGold,
                    rice: newRice,
                    experience: nextExp,
                    dedication: nextDed,
                    meta: {
                        ...general.meta,
                        betrayal: betrayal + 1,
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
> implements GeneralActionDefinition<TriggerState, ResignArgs, GeneralActionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor() {
        this.resolver = new ActionResolver();
    }

    parseArgs(_raw: unknown): ResignArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: ResignArgs): Constraint[] {
        return [notBeNeutral()];
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: ResignArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: ACTION_KEY,
    category: '인사',
    reqArg: false,

    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
