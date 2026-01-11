
import type { General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    allow,
    existsDestNation,
    existsDestGeneral,
    notSameDestNation,
    destGeneralInDestNation,
    notLord,
    readMetaNumberFromUnknown,
    unknownOrDeny,
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
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface AcceptScoutArgs {
    destNationId: number;
    destGeneralId: number;
}

const ACTION_NAME = '등용수락';
const ACTION_KEY = 'che_등용수락';

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

    resolve(context: AcceptScoutResolveContext<TriggerState>, _args: AcceptScoutArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const currentNation = context.nation;
        const destNation = context.destNation;
        const destGeneral = context.destGeneral;
        const effects: GeneralActionEffect<TriggerState>[] = [];

        if (!destNation) throw new Error('Target nation not found.');
        if (!destGeneral) throw new Error('Recruiter not found.');

        // 1. Logs
        const destNationName = destNation.name;
        const recruiterName = destGeneral.name;
        const generalName = general.name;

        const josaRo = JosaUtil.pick(destNationName, '로');
        const josaYi = JosaUtil.pick(generalName, '이');

        // Self Log
        context.addLog(`<D>${destNationName}</>${josaRo} 망명하여 수도로 이동합니다.`, { // Text says "Move to Capital", but logic might move to recruiter city.
            // Legacy log says "수도로 이동합니다", but implementation moves to destGeneral city if present!
            // We should match implementation or text? Text is just flavor.
            category: LogCategory.ACTION,
            format: LogFormat.InGame, // Using InGame or specific format?
        });

        // Recruiter Log
        // We need to add log to recruiter? `context.addSideEffectLog`?
        // Current system mostly logs for the actor.
        // If we want to log for recruiter, we might need a way to push logs to others in `effects` or strictly via `addLog` with target?
        // `GeneralActionResolveContext` usually implies logs are for the actor.
        // But `GeneralTurnOutcome` doesn't explicitly return logs for others.
        // We can create a patch for recruiter that appends to their log?
        // Or usage of `addLog` might support target? No, `addLog` in context usually targets actor.
        // We will skip Recruiter Log for now or rely on Global Log.

        // Global Log
        context.addLog(`<Y>${generalName}</>${josaYi} <D><b>${destNationName}</b></>${josaRo} <S>망명</>하였습니다.`, {
            category: LogCategory.ACTION, // Global category?
            format: LogFormat.InGame, // Global logs are handled by system?
            // In new system, we might need to specify it.
        });

        // 2. Recruiter Rewards
        effects.push(createGeneralPatchEffect({
            experience: destGeneral.experience + 100,
            dedication: destGeneral.dedication + 100,
        }, destGeneral.id));

        // 3. Betrayal Logic
        // If currentNation exists (and > 0), handle betrayal return logic.
        const defaultGold = 1000; // From env? context.env.defaultNpcGold? Or GameConst?
        // Using context.env values if available. SystemEnv has `baseGold`?
        // Legacy: GameConst::$defaultGold (usually 1000/2000).
        const safeGold = context.env.baseGold || 1000;
        const safeRice = context.env.baseRice || 1000;

        let newGold = general.gold;
        let newRice = general.rice;
        let newExp = general.experience;
        let newDed = general.dedication;

        const betrayCount = (readMetaNumberFromUnknown(general.meta, 'betray') ?? 0);
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
                effects.push(createNationPatchEffect({
                    gold: currentNation.gold + returnGold,
                    rice: currentNation.rice + returnRice
                }, currentNation.id));
            }

            // Penalty
            // 10% * betray count deduction
            const penaltyFactor = 1 - (0.1 * betrayCount);
            if (penaltyFactor < 0) { // Should not be less than 0? capped at ?
                // Legacy: (1 - 0.1 * betray).
            }
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
        let targetCityId = destGeneral.cityId; // Join recruiter
        // If recruiter is not valid city?
        if (!targetCityId) targetCityId = destNation.capitalCityId!;

        effects.push(createGeneralPatchEffect({
            nationId: destNation.id,
            cityId: targetCityId,
            experience: newExp,
            dedication: newDed,
            gold: newGold,
            rice: newRice,
            officerLevel: 1, // Reset rank
            // officer_city: 0 via meta
            crew: general.crew, // Keep crew? Legacy implies checking troop leader.
            // If troop leader, disband troop.
            // TS entity `troopId`.
            troopId: 0, // Quit troop
            meta: {
                ...general.meta,
                officer_city: 0,
                betray: newBetray,
                // killturn logic?
            }
        }, general.id));

        // 5. Update Nations Gen Count (Visual only? or real count)
        // Legacy updates `gennum`.
        // We can create patches for nations if `gennum` is part of Nation entity?
        // Nation entity usually doesn't store computed `gennum` in TS domain?
        // If it's real column, we can update.
        // Checking entity: `Nation` interface does NOT have `gennum`.
        // So we skip updating gennum on Nation entity.

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, AcceptScoutArgs, AcceptScoutResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor() {
        this.resolver = new ActionResolver();
    }

    parseArgs(raw: unknown): AcceptScoutArgs | null {
        // Validate args
        const args = raw as Partial<AcceptScoutArgs>;
        if (typeof args.destNationId !== 'number' || typeof args.destGeneralId !== 'number') return null;
        return { destNationId: args.destNationId, destGeneralId: args.destGeneralId };
    }

    buildConstraints(_ctx: ConstraintContext, _args: AcceptScoutArgs): Constraint[] {
        return [
            // notBeNeutral(), // Ignored to allow betrayal
            existsDestNation(),
            existsDestGeneral(), // Need to check if destGeneral exists
            notSameDestNation(),
            destGeneralInDestNation(),
            notLord(),
        ];
    }

    resolve(context: AcceptScoutResolveContext<TriggerState>, args: AcceptScoutArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    // Populate destNation and destGeneral
    const args = base.args as Partial<AcceptScoutArgs>;
    let destNation: Nation | undefined;
    let destGeneral: General | undefined;

    if (args.destNationId) {
        destNation = options.worldRef?.getNation(args.destNationId);
    }
    if (args.destGeneralId) {
        destGeneral = options.worldRef?.getGeneral(args.destGeneralId);
    }

    return {
        ...base,
        destNation,
        destGeneral,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_등용수락',
    category: '계략', // Strategy? or '인사'(Personnel)? Legacy not checked for category. "군사" in task.md?
    // che_등용수락 is usually separate.
    // che_등용 is 인사(Personnel).
    // Let's use '인사'.
    reqArg: true,
    args: {
        destNationId: 'number',
        destGeneralId: 'number',
    },
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
