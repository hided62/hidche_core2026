import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { beChief, occupiedCity, suppliedCity, reqNationAuxValue } from '@sammo-ts/logic/constraints/presets.js';
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
import { getLegacyStringWidth } from '@sammo-ts/logic/troop/management.js';

const ARGS_SCHEMA = z.object({
    nationName: z.string().superRefine((nationName, ctx) => {
        if (nationName === '' || getLegacyStringWidth(nationName) > 18) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: '국호는 전각 9자 또는 반각 18자 이하여야 합니다.',
            });
        }
    }),
});
export type ChangeNationNameArgs = z.infer<typeof ARGS_SCHEMA>;

const ACTION_NAME = '국호변경';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, ChangeNationNameArgs> {
    public readonly key = 'che_국호변경';
    public readonly name = ACTION_NAME;
    public readonly countsAsInheritanceActiveAction = true;

    parseArgs(raw: unknown): ChangeNationNameArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: ChangeNationNameArgs): Constraint[] {
        return [
            occupiedCity(),
            beChief(),
            suppliedCity(),
            reqNationAuxValue(`can_${ACTION_NAME}`, 0, '>', 0, '더이상 변경이 불가능합니다.'),
        ];
    }

    buildConstraints(_ctx: ConstraintContext, _args: ChangeNationNameArgs): Constraint[] {
        void _args;
        return [
            occupiedCity(),
            beChief(),
            suppliedCity(),
            reqNationAuxValue(`can_${ACTION_NAME}`, 0, '>', 0, '더이상 변경이 불가능합니다.'),
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

        if (context.worldView?.listNations?.().some((candidate) => candidate.name === newNationName)) {
            return {
                completed: false,
                effects: [
                    createLogEffect(`이미 같은 국호를 가진 곳이 있습니다. ${ACTION_NAME} 실패`, {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        format: LogFormat.MONTH,
                    }),
                ],
            };
        }

        const josaYi = JosaUtil.pick(generalName, '이');
        const josaYiNation = JosaUtil.pick(oldNationName, '이');
        const josaRo = JosaUtil.pick(newNationName, '로');

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
            createLogEffect(`<Y>${generalName}</>${josaYi} 국호를 <D><b>${newNationName}</b></>${josaRo} 변경합니다.`, {
                scope: LogScope.SYSTEM,
                category: LogCategory.SUMMARY,
                format: LogFormat.MONTH,
            }),
            // Global History Log
            createLogEffect(
                `<S><b>【${ACTION_NAME}】</b></><D><b>${oldNationName}</b></>${josaYiNation} 국호를 <D><b>${newNationName}</b></>${josaRo} 변경합니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            // Actor Nation History Log
            createLogEffect(`<Y>${generalName}</>${josaYi} 국호를 <D><b>${newNationName}</b></>${josaRo} 변경`, {
                scope: LogScope.NATION,
                nationId: nation.id,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }),
            createLogEffect(`국호를 <D><b>${newNationName}</b></>${josaRo} 변경`, {
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }),
            // General Action Log
            createLogEffect(`국호를 <D><b>${newNationName}</b></>${josaRo} 변경합니다.`, {
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
