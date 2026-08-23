import type { GeneralMeta, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
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

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, BattlePreparationArgs> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;

    constructor(private readonly env: TurnCommandEnv) {}

    getPreReqTurn(): number {
        return 3;
    }

    getPostReqTurn(): number {
        return 0;
    }

    parseArgs(_raw: unknown): BattlePreparationArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: BattlePreparationArgs): Constraint[] {
        const nationRequirement = _ctx.nationId !== undefined ? [{ kind: 'nation', id: _ctx.nationId } as const] : [];
        return [
            notBeNeutral(),
            notWanderingNation(),
            occupiedCity(),
            reqGeneralCrew(),
            reqGeneralGold((ctx, view) => {
                const general = view.get({ kind: 'general', id: ctx.actorId }) as { crew?: number } | null;
                const nation =
                    ctx.nationId !== undefined
                        ? (view.get({ kind: 'nation', id: ctx.nationId }) as Nation | null)
                        : null;
                const crew = typeof general?.crew === 'number' ? general.crew : 0;
                const techCost = getTechCost(readNationTech(nation), this.env.maxTechLevel);
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
        const crew = general.crew;

        const lastTurn = general.lastTurn;
        const term =
            lastTurn?.command !== ACTION_NAME
                ? 1
                : lastTurn.term === REQ_TERM
                  ? 1
                  : typeof lastTurn.term === 'number' && lastTurn.term < REQ_TERM
                    ? lastTurn.term + 1
                    : 1;
        const resultTurn = { command: ACTION_NAME, term };

        if (term < REQ_TERM) {
            context.addLog(`병사들을 열심히 훈련중... (${term}/3)`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            return {
                effects: [
                    createGeneralPatchEffect<TriggerState>({
                        lastTurn: resultTurn,
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
        const crewType = this.env.unitSet?.crewTypes?.find((entry) => entry.id === general.crewTypeId);
        const dexKey = crewType ? `dex${crewType.armType}` : null;
        const nextMeta: GeneralMeta = {
            ...general.meta,
            leadership_exp: leadershipExp + 3,
        };
        if (dexKey) {
            const dex = typeof nextMeta[dexKey] === 'number' ? nextMeta[dexKey] : 0;
            nextMeta[dexKey] = dex + (crew / 100) * 3;
        }

        return {
            effects: [
                createGeneralPatchEffect<TriggerState>({
                    lastTurn: resultTurn,
                    train: Math.max(general.train, this.env.maxTrainByCommand - 5),
                    atmos: Math.max(general.atmos, this.env.maxAtmosByCommand - 5),
                    experience: general.experience + 300,
                    dedication: general.dedication + 210,
                    meta: nextMeta,
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
