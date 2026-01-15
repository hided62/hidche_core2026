import type { GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import { allow, unknownOrDeny } from '@sammo-ts/logic/constraints/helpers.js';
import { beChief, occupiedCity, reqNationGold, reqNationRice } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { createLogEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';
import { JosaUtil } from '@sammo-ts/common';

export interface EventResearchConfig {
    key: string;
    name: string;
    auxKey: string;
    preReqTurn: number;
    cost: number;
    category?: string;
}

const requireNationAux = (auxKey: string, actionName: string): Constraint => ({
    name: 'requireNationAux',
    requires: (ctx) => (ctx.nationId !== undefined ? [{ kind: 'nation', id: ctx.nationId }] : []),
    test: (ctx: ConstraintContext, view: StateView) => {
        if (ctx.nationId === undefined) {
            return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
        }
        const nation = view.get({ kind: 'nation', id: ctx.nationId }) as Nation | null;
        if (!nation) {
            return unknownOrDeny(ctx, [{ kind: 'nation', id: ctx.nationId }], '국가 정보가 없습니다.');
        }
        const current = typeof nation.meta?.[auxKey] === 'number' ? Number(nation.meta?.[auxKey]) : 0;
        if (current >= 1) {
            return { kind: 'deny', reason: `${actionName}가 이미 완료되었습니다.` };
        }
        return allow();
    },
});

export const createEventResearchCommand = (config: EventResearchConfig): {
    ActionDefinition: new <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
        env: TurnCommandEnv
    ) => GeneralActionDefinition<TriggerState, Record<string, never>>;
    commandSpec: NationTurnCommandSpec;
    actionContextBuilder: ActionContextBuilder;
} => {
    const ACTION_NAME = config.name;
    const COST = config.cost;
    const PRE_REQ_TURN = config.preReqTurn;
    const EXP_DED_GAIN = 5 * (PRE_REQ_TURN + 1);
    const CATEGORY = config.category ?? '특수';

    class ActionDefinition<
        TriggerState extends GeneralTriggerState = GeneralTriggerState,
    > implements GeneralActionDefinition<TriggerState, Record<string, never>> {
        public readonly key = config.key;
        public readonly name = ACTION_NAME;

        constructor(private readonly env: TurnCommandEnv) {}

        parseArgs(_raw: unknown): Record<string, never> | null {
            void _raw;
            return {};
        }

        buildConstraints(_ctx: ConstraintContext, _args: Record<string, never>): Constraint[] {
            void _ctx;
            void _args;
            return [
                occupiedCity(),
                beChief(),
                requireNationAux(config.auxKey, ACTION_NAME),
                reqNationGold(() => this.env.baseGold + COST),
                reqNationRice(() => this.env.baseRice + COST),
            ];
        }

        resolve(
            context: GeneralActionResolveContext<TriggerState>,
            _args: Record<string, never>
        ): GeneralActionOutcome<TriggerState> {
            void _args;
            const { general, nation } = context;
            if (!nation) {
                return {
                    effects: [
                        createLogEffect('국가 정보가 없습니다.', {
                            scope: LogScope.GENERAL,
                            category: LogCategory.ACTION,
                            format: LogFormat.MONTH,
                        }),
                    ],
                };
            }

            general.experience += EXP_DED_GAIN;
            general.dedication += EXP_DED_GAIN;

            const generalName = general.name;
            const josaYi = JosaUtil.pick(generalName, '이');

            return {
                effects: [
                    createNationPatchEffect(
                        {
                            gold: nation.gold - COST,
                            rice: nation.rice - COST,
                            meta: {
                                ...nation.meta,
                                [config.auxKey]: 1,
                            },
                        },
                        nation.id
                    ),
                    createLogEffect(`<M>${ACTION_NAME}</> 완료`, {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        format: LogFormat.MONTH,
                    }),
                    createLogEffect(`<M>${ACTION_NAME}</> 완료`, {
                        scope: LogScope.GENERAL,
                        category: LogCategory.HISTORY,
                        format: LogFormat.YEAR_MONTH,
                    }),
                    createLogEffect(`<Y>${generalName}</>${josaYi} <M>${ACTION_NAME}</> 완료`, {
                        scope: LogScope.NATION,
                        category: LogCategory.HISTORY,
                        format: LogFormat.YEAR_MONTH,
                    }),
                ],
            };
        }
    }

    const commandSpec: NationTurnCommandSpec = {
        key: config.key as NationTurnCommandSpec['key'],
        category: CATEGORY,
        reqArg: false,
        args: {},
        createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
    };

    return {
        ActionDefinition,
        commandSpec,
        actionContextBuilder: defaultActionContextBuilder,
    };
};
