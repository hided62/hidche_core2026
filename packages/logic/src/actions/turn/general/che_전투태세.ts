import type { GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    occupiedCity,
    reqGeneralAtmosMargin,
    reqGeneralCrew,
    reqGeneralGold,
    reqGeneralRice,
    reqGeneralTrainMargin,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import { getTechCost } from '@sammo-ts/logic/world/unitSet.js';
import type { GeneralTurnCommandSpec } from './index.js';

const ACTION_NAME = '전투태세';
const ACTION_KEY = 'che_전투태세';
const REQ_TERM = 3;

export interface BattlePreparationArgs {}

const readNationTech = (nation: Nation | null | undefined): number => {
    if (!nation) {
        return 0;
    }
    const tech = nation.meta.tech;
    return typeof tech === 'number' ? tech : 0;
};

const readBattleStanceTerm = (meta: Record<string, unknown>): number => {
    const value = meta.battle_stance_term;
    return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, BattlePreparationArgs> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;

    constructor(private readonly env: TurnCommandEnv) {}

    parseArgs(_raw: unknown): BattlePreparationArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: BattlePreparationArgs): Constraint[] {
        const nationRequirement =
            _ctx.nationId !== undefined ? [{ kind: 'nation', id: _ctx.nationId } as const] : [];
        return [
            notBeNeutral(),
            notWanderingNation(),
            occupiedCity(),
            reqGeneralCrew(),
            reqGeneralGold((ctx, view) => {
                const general = view.get({ kind: 'general', id: ctx.actorId }) as { crew?: number } | null;
                const nation =
                    ctx.nationId !== undefined ? (view.get({ kind: 'nation', id: ctx.nationId }) as Nation | null) : null;
                const crew = typeof general?.crew === 'number' ? general.crew : 0;
                const techCost = getTechCost(readNationTech(nation));
                return Math.round((crew / 100) * 3 * techCost);
            }, nationRequirement),
            reqGeneralRice(() => 0),
            reqGeneralTrainMargin(Math.max(0, this.env.maxTrainByCommand - 10)),
            reqGeneralAtmosMargin(Math.max(0, this.env.maxAtmosByCommand - 10)),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: BattlePreparationArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        const crew = general.crew;
        const techCost = getTechCost(readNationTech(nation));
        const costGold = Math.round((crew / 100) * 3 * techCost);

        const previousTerm = readBattleStanceTerm(general.meta as Record<string, unknown>);
        const term = previousTerm >= REQ_TERM ? 1 : previousTerm + 1;

        if (term < REQ_TERM) {
            context.addLog(`병사들을 열심히 훈련중... (${term}/3)`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            return {
                effects: [
                    createGeneralPatchEffect<TriggerState>({
                        gold: Math.max(0, general.gold - costGold),
                        meta: {
                            ...general.meta,
                            battle_stance_term: term,
                        },
                    }),
                ],
            };
        }

        context.addLog(`전투태세 완료! (${term}/3)`, {
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        const leadershipExp = typeof general.meta.leadership_exp === 'number' ? general.meta.leadership_exp : 0;

        return {
            effects: [
                createGeneralPatchEffect<TriggerState>({
                    gold: Math.max(0, general.gold - costGold),
                    experience: general.experience + 300,
                    dedication: general.dedication + 210,
                    meta: {
                        ...general.meta,
                        battle_stance_term: term,
                        leadership_exp: leadershipExp + 3,
                    },
                }),
            ],
        };
    }
}

export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: ACTION_KEY,
    category: '군사',
    reqArg: false,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
