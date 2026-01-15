import type { GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import { beChief, occupiedCity, suppliedCity, checkNationNameDuplicate } from '@sammo-ts/logic/constraints/presets.js';
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
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    nationName: z.string().trim().min(1).max(8),
});
export type ChangeNationNameArgs = z.infer<typeof ARGS_SCHEMA>;

const ACTION_NAME = '국호변경';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, ChangeNationNameArgs> {
    public readonly key = 'che_국호변경';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): ChangeNationNameArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: ChangeNationNameArgs): Constraint[] {
        return [
            occupiedCity(),
            beChief(),
            suppliedCity(),
            {
                name: 'canChangeNationName',
                requires: (ctx) => [{ kind: 'nation', id: ctx.nationId! }],
                test: (_ctx: ConstraintContext, view: StateView) => {
                    const nation = view.get({ kind: 'nation', id: _ctx.nationId! }) as Nation | undefined;
                    const canChangeRaw = nation?.meta[`can_${ACTION_NAME}`];
                    const canChange = (typeof canChangeRaw === 'number' ? canChangeRaw : 0) !== 0;
                    if (!canChange) return { kind: 'deny', reason: '더이상 변경이 불가능합니다.' };
                    return { kind: 'allow' };
                },
            },
        ];
    }

    buildConstraints(_ctx: ConstraintContext, args: ChangeNationNameArgs): Constraint[] {
        return [
            occupiedCity(),
            beChief(),
            suppliedCity(),
            checkNationNameDuplicate(args.nationName),
            {
                name: 'canChangeNationName',
                requires: (ctx) => [{ kind: 'nation', id: ctx.nationId! }],
                test: (_ctx: ConstraintContext, view: StateView) => {
                    const nation = view.get({ kind: 'nation', id: _ctx.nationId! }) as Nation | undefined;
                    const canChangeRaw = nation?.meta[`can_${ACTION_NAME}`];
                    const canChange = (typeof canChangeRaw === 'number' ? canChangeRaw : 0) !== 0;
                    if (!canChange) return { kind: 'deny', reason: '더이상 변경이 불가능합니다.' };
                    return { kind: 'allow' };
                },
            },
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: ChangeNationNameArgs
    ): GeneralActionOutcome<TriggerState> {
        const { general, nation } = context;
        if (!nation) {
            return { effects: [createLogEffect('국가 정보가 없습니다.', { scope: LogScope.GENERAL })] };
        }

        const generalName = general.name;
        const oldNationName = nation.name;
        const newNationName = args.nationName;

        const josaYi = JosaUtil.pick(generalName, '이');
        const josaYiNation = JosaUtil.pick(newNationName, '이');

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createNationPatchEffect(
                {
                    name: newNationName,
                    meta: {
                        ...nation.meta,
                        [`can_${ACTION_NAME}`]: 0,
                    },
                },
                nation.id
            ),
            // Global Action Log
            createLogEffect(`<Y>${generalName}</>${josaYi} 국호를 <D><b>${newNationName}</b></>로 변경하였습니다.`, {
                scope: LogScope.SYSTEM,
                category: LogCategory.ACTION,
                format: LogFormat.PLAIN,
            }),
            // Global History Log
            createLogEffect(
                `<S><b>【${ACTION_NAME}】</b></><D><b>${oldNationName}</b></>${josaYiNation} 국호를 <D><b>${newNationName}</b></>로 변경하였습니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            // Actor Nation History Log
            createLogEffect(`<Y>${generalName}</>${josaYi} 국호를 <D><b>${newNationName}</b></>로 변경하였습니다.`, {
                scope: LogScope.NATION,
                nationId: nation.id,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }),
            // General Action Log
            createLogEffect(`국호를 <D><b>${newNationName}</b></>로 변경하였습니다.`, {
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

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_국호변경',
    category: '국가',
    reqArg: true,
    availabilityArgs: { nationName: '' },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
