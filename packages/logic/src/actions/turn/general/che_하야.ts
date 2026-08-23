import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { notBeNeutral, notLord } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { JosaUtil } from '@sammo-ts/common';

export interface ResignArgs {}
interface ResignContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    troopMembers: General<TriggerState>[];
}

const ACTION_NAME = '하야';
const ACTION_KEY = 'che_하야';

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, ResignArgs> {
    readonly key = ACTION_KEY;
    constructor(private readonly env: TurnCommandEnv) {}

    resolve(context: ResignContext<TriggerState>, _args: ResignArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;

        if (!nation) {
            throw new Error('Resign requires a nation context.');
        }

        const effects: GeneralActionOutcome<TriggerState>['effects'] = [];

        // Return resources
        const maxKeepGold = this.env.defaultNpcGold;
        const maxKeepRice = this.env.defaultNpcRice;

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
        const betrayal = typeof general.meta.betray === 'number' ? general.meta.betray : 0;
        const belong = typeof general.meta.belong === 'number' ? general.meta.belong : 0;
        const maxBelong = typeof general.meta.max_belong === 'number' ? general.meta.max_belong : 0;
        const penaltyRatio = betrayal * 0.1;
        const nextExp = Math.round(general.experience * (1 - penaltyRatio));
        const nextDed = Math.round(general.dedication * (1 - penaltyRatio));

        context.addLog(`<D><b>${nation.name}</b></>에서 하야했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        context.addLog(`<D><b>${nation.name}</b></>에서 하야`, {
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });
        const josaYi = JosaUtil.pick(general.name, '이');
        context.addLog(`<Y>${general.name}</>${josaYi} <D><b>${nation.name}</b></>에서 <R>하야</>했습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.SUMMARY,
            format: LogFormat.RAWTEXT,
        });

        effects.push(
            createGeneralPatchEffect(
                {
                    ...general,
                    nationId: 0,
                    officerLevel: 0,
                    troopId: 0,
                    gold: newGold,
                    rice: newRice,
                    experience: nextExp,
                    dedication: nextDed,
                    meta: {
                        ...general.meta,
                        betray: Math.min(9, betrayal + 1),
                        belong: 0,
                        ...(general.npcState < 2 ? { max_belong: Math.max(belong, maxBelong) } : {}),
                        makelimit: 12,
                        officer_city: 0,
                        permission: 'normal',
                    },
                },
                general.id
            )
        );
        if (general.troopId === general.id) {
            for (const member of context.troopMembers) {
                effects.push(createGeneralPatchEffect({ troopId: 0 }, member.id));
            }
        }
        const gennum = typeof nation.meta.gennum === 'number' ? nation.meta.gennum : 0;
        effects.push(
            createNationPatchEffect(
                {
                    meta: {
                        ...nation.meta,
                        gennum: Math.max(0, gennum - (general.npcState === 5 ? 0 : 1)),
                    },
                },
                nation.id
            )
        );

        return {
            effects,
            ...(general.troopId === general.id ? { deletedTroopIds: [general.id] } : {}),
        };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, ResignArgs, ResignContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    getInheritanceActiveActionAmount(): number {
        return 1;
    }
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(env: TurnCommandEnv) {
        this.resolver = new ActionResolver(env);
    }

    parseArgs(_raw: unknown): ResignArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: ResignArgs): Constraint[] {
        return [notBeNeutral(), notLord()];
    }

    resolve(context: ResignContext<TriggerState>, args: ResignArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => ({
    ...base,
    troopMembers: options.worldRef?.listGenerals().filter((general) => general.troopId === base.general.id) ?? [],
});

export const commandSpec: GeneralTurnCommandSpec = {
    key: ACTION_KEY,
    category: '인사',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
