import type { GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    beChief,
    occupiedCity,
    suppliedCity,
    differentDestNation,
    existsDestNation,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { createLogEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { clamp } from 'es-toolkit';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    destNationId: z.number(),
    amountList: z.tuple([z.number(), z.number()]),
});
export type MaterialAidArgs = z.infer<typeof ARGS_SCHEMA>;

export interface MaterialAidResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destNation: Nation;
}

const ACTION_NAME = '원조';
const COEF_AID_AMOUNT = 10000;
const POST_REQ_TURN = 12;

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, MaterialAidArgs, MaterialAidResolveContext<TriggerState>> {
    public readonly key = 'che_물자원조';
    public readonly name = ACTION_NAME;

    constructor(private readonly env: TurnCommandEnv) {}

    parseArgs(raw: unknown): MaterialAidArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: MaterialAidArgs): Constraint[] {
        return [
            occupiedCity(),
            beChief(),
            suppliedCity(),
            {
                name: 'nationSurlimit',
                requires: (ctx) => [{ kind: 'nation', id: ctx.nationId! }],
                test: (_ctx: ConstraintContext, view: StateView) => {
                    const nation = view.get({ kind: 'nation', id: _ctx.nationId! }) as Nation | undefined;
                    const surlimitRaw = nation?.meta.surlimit;
                    const surlimit = typeof surlimitRaw === 'number' ? surlimitRaw : 0;
                    if (surlimit > 0) return { kind: 'deny', reason: '외교제한중입니다.' };
                    return { kind: 'allow' };
                },
            },
        ];
    }

    buildConstraints(_ctx: ConstraintContext, args: MaterialAidArgs): Constraint[] {
        const [goldAmount, riceAmount] = args.amountList;
        return [
            occupiedCity(),
            beChief(),
            suppliedCity(),
            existsDestNation(),
            differentDestNation(),
            {
                name: 'aidLimit',
                requires: (ctx) => [{ kind: 'nation', id: ctx.nationId! }],
                test: (ctx: ConstraintContext, view: StateView) => {
                    const nation = view.get({ kind: 'nation', id: ctx.nationId! }) as Nation | undefined;
                    const limit = (nation?.level ?? 1) * COEF_AID_AMOUNT;
                    if (goldAmount > limit || riceAmount > limit) {
                        return { kind: 'deny', reason: '작위 제한량 이상은 보낼 수 없습니다.' };
                    }
                    return { kind: 'allow' };
                },
            },
            {
                name: 'nationSurlimit',
                requires: (ctx) => [{ kind: 'nation', id: ctx.nationId! }],
                test: (_ctx: ConstraintContext, view: StateView) => {
                    const nation = view.get({ kind: 'nation', id: _ctx.nationId! }) as Nation | undefined;
                    const surlimitRaw = nation?.meta.surlimit;
                    const surlimit = typeof surlimitRaw === 'number' ? surlimitRaw : 0;
                    if (surlimit > 0) return { kind: 'deny', reason: '외교제한중입니다.' };
                    return { kind: 'allow' };
                },
            },
            {
                name: 'destNationSurlimit',
                requires: () => [{ kind: 'nation', id: args.destNationId }],
                test: (_ctx: ConstraintContext, view: StateView) => {
                    const destNation = view.get({ kind: 'nation', id: args.destNationId }) as Nation | undefined;
                    const surlimitRaw = destNation?.meta.surlimit;
                    const surlimit = typeof surlimitRaw === 'number' ? surlimitRaw : 0;
                    if (surlimit > 0) return { kind: 'deny', reason: '상대국이 외교제한중입니다.' };
                    return { kind: 'allow' };
                },
            },
        ];
    }

    resolve(
        context: MaterialAidResolveContext<TriggerState>,
        args: MaterialAidArgs
    ): GeneralActionOutcome<TriggerState> {
        const { general, nation, destNation } = context;
        if (!nation || !destNation) {
            return { effects: [createLogEffect('국가 정보가 없습니다.', { scope: LogScope.GENERAL })] };
        }

        const [goldAmount, riceAmount] = args.amountList;

        // Fit amount to nation's resources
        const actualGold = clamp(goldAmount, 0, Math.max(0, nation.gold - this.env.baseGold));
        const actualRice = clamp(riceAmount, 0, Math.max(0, nation.rice - this.env.baseRice));

        const goldText = actualGold.toLocaleString();
        const riceText = actualRice.toLocaleString();
        const josaUlRice = JosaUtil.pick(riceText, '을');
        const josaRo = JosaUtil.pick(destNation.name, '로');
        const nationName = nation.name;

        const broadcastMessage = `<D><b>${destNation.name}</b></>${josaRo} 금<C>${goldText}</> 쌀<C>${riceText}</>을 지원했습니다.`;

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createNationPatchEffect(
                {
                    gold: nation.gold - actualGold,
                    rice: nation.rice - actualRice,
                    meta: {
                        ...nation.meta,
                        surlimit: Number(nation.meta.surlimit ?? 0) + POST_REQ_TURN,
                    },
                },
                nation.id
            ),
            createNationPatchEffect(
                {
                    gold: destNation.gold + actualGold,
                    rice: destNation.rice + actualRice,
                },
                destNation.id
            ),
            // Global History Log
            createLogEffect(
                `<Y><b>【${ACTION_NAME}】</b></><D><b>${nationName}</b></>에서 <D><b>${destNation.name}</b></>${josaRo} 물자를 지원합니다`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            // Actor Nation History Log
            createLogEffect(
                `<D><b>${destNation.name}</b></>${josaRo} 금<C>${goldText}</> 쌀<C>${riceText}</>${josaUlRice} 지원`,
                {
                    scope: LogScope.NATION,
                    nationId: nation.id,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            // Dest Nation History Log
            createLogEffect(
                `<D><b>${nationName}</b></>로부터 금<C>${goldText}</> 쌀<C>${riceText}</>${josaUlRice} 지원 받음`,
                {
                    scope: LogScope.NATION,
                    nationId: destNation.id,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            // General Action Log
            createLogEffect(broadcastMessage, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            }),
        ];

        general.experience += 5;
        general.dedication += 5;

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder<MaterialAidArgs> = (base, options) => {
    const destNationId = options.actionArgs.destNationId;
    if (typeof destNationId !== 'number') return null;

    const worldRef = options.worldRef;
    if (!worldRef) return null;

    const destNation = worldRef.getNationById(destNationId);
    if (!destNation) return null;

    return {
        ...base,
        destNation,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_물자원조',
    category: '외교',
    reqArg: true,
    availabilityArgs: { destNationId: 0, amountList: [0, 0] },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
