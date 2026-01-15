import type { General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    existsDestNation,
    existsDestGeneral,
    notSameDestNation,
    destGeneralInDestNation,
    notLord,
    readMetaNumberFromUnknown,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
    GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';

const ACTION_NAME = '등용수락';
const ACTION_KEY = 'che_등용수락';
const ARGS_SCHEMA = z.object({
    destNationId: z.number(),
    destGeneralId: z.number(),
});
export type AcceptScoutArgs = z.infer<typeof ARGS_SCHEMA>;

export interface AcceptScoutResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destNation?: Nation;
    destGeneral?: General<TriggerState>;
}

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, AcceptScoutArgs> {
    readonly key = ACTION_KEY;

    constructor(private readonly env: TurnCommandEnv) {}

    resolve(
        context: AcceptScoutResolveContext<TriggerState>,
        _args: AcceptScoutArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const currentNation = context.nation;
        const destNation = context.destNation;
        const destGeneral = context.destGeneral;
        const effects: GeneralActionEffect<TriggerState>[] = [];

        if (!destNation) throw new Error('Target nation not found.');
        if (!destGeneral) throw new Error('Recruiter not found.');

        // 1. Logs
        const destNationName = destNation.name;
        const generalName = general.name;

        const josaRo = JosaUtil.pick(destNationName, '로');
        const josaYi = JosaUtil.pick(generalName, '이');

        // Self Log
        context.addLog(`<D>${destNationName}</>${josaRo} 망명하여 수도로 이동합니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.PLAIN,
        });

        // Global Log
        context.addLog(`<Y>${generalName}</>${josaYi} <D><b>${destNationName}</b></>${josaRo} <S>망명</>하였습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.PLAIN,
        });

        // 2. Recruiter Rewards
        effects.push(
            createGeneralPatchEffect(
                {
                    experience: destGeneral.experience + 100,
                    dedication: destGeneral.dedication + 100,
                },
                destGeneral.id
            )
        );

        // 3. Betrayal Logic
        // Legacy: GameConst::$defaultGold (usually 1000/2000).
        const safeGold = this.env.baseGold || 1000;
        const safeRice = this.env.baseRice || 1000;

        let newGold = general.gold;
        let newRice = general.rice;
        let newExp = general.experience;
        let newDed = general.dedication;

        const betrayCount = readMetaNumberFromUnknown(general.meta, 'betray') ?? 0;
        let newBetray = betrayCount;

        if (currentNation && currentNation.id !== 0) {
            // Return excess gold/rice to current nation
            let returnGold = 0;
            let returnRice = 0;

            if (general.gold > safeGold) {
                returnGold = general.gold - safeGold;
                newGold = safeGold;
            }
            if (general.rice > safeRice) {
                returnRice = general.rice - safeRice;
                newRice = safeRice;
            }

            if (returnGold > 0 || returnRice > 0) {
                effects.push(
                    createNationPatchEffect(
                        {
                            gold: currentNation.gold + returnGold,
                            rice: currentNation.rice + returnRice,
                        },
                        currentNation.id
                    )
                );
            }

            // Penalty
            // 10% * betray count deduction
            const penaltyFactor = 1 - 0.1 * betrayCount;
            // Apply penalty
            newExp = Math.floor(newExp * Math.max(0, penaltyFactor));
            newDed = Math.floor(newDed * Math.max(0, penaltyFactor));
            newBetray += 1;
        } else {
            // Neutral -> Join: Grant Bonus
            newExp += 100;
            newDed += 100;
        }

        // 4. Update General (Self)
        const targetCityId = destNation.capitalCityId;
        if (!targetCityId) throw new Error('Capital city not found.');

        effects.push(
            createGeneralPatchEffect(
                {
                    nationId: destNation.id,
                    cityId: targetCityId,
                    experience: newExp,
                    dedication: newDed,
                    gold: newGold,
                    rice: newRice,
                    officerLevel: 1, // Reset rank
                    troopId: 0, // Quit troop
                    meta: {
                        ...general.meta,
                        officer_city: 0,
                        betray: newBetray,
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
> implements GeneralActionDefinition<TriggerState, AcceptScoutArgs, AcceptScoutResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(env: TurnCommandEnv) {
        this.resolver = new ActionResolver(env);
    }

    parseArgs(raw: unknown): AcceptScoutArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildConstraints(_ctx: ConstraintContext, _args: AcceptScoutArgs): Constraint[] {
        return [existsDestNation(), existsDestGeneral(), notSameDestNation(), destGeneralInDestNation(), notLord()];
    }

    resolve(
        context: AcceptScoutResolveContext<TriggerState>,
        args: AcceptScoutArgs
    ): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const args = options.actionArgs as Partial<AcceptScoutArgs>;
    let destNation: Nation | undefined;
    let destGeneral: General | undefined;

    if (args.destNationId) {
        destNation = options.worldRef?.getNationById(args.destNationId) ?? undefined;
    }
    if (args.destGeneralId) {
        destGeneral = options.worldRef?.getGeneralById(args.destGeneralId) ?? undefined;
    }

    return {
        ...base,
        destNation,
        destGeneral,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_등용수락',
    category: '인사',
    reqArg: true,
    availabilityArgs: {
        destNationId: 'number',
        destGeneralId: 'number',
    },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
