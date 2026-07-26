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

const ACTION_NAME = '국기변경';

const NATION_COLORS = [
    '#FF0000',
    '#800000',
    '#A0522D',
    '#FF6347',
    '#FFA500',
    '#FFDAB9',
    '#FFD700',
    '#FFFF00',
    '#7CFC00',
    '#00FF00',
    '#808000',
    '#008000',
    '#2E8B57',
    '#008080',
    '#20B2AA',
    '#6495ED',
    '#7FFFD4',
    '#AFEEEE',
    '#87CEEB',
    '#00FFFF',
    '#00BFFF',
    '#0000FF',
    '#000080',
    '#483D8B',
    '#7B68EE',
    '#BA55D3',
    '#800080',
    '#FF00FF',
    '#FFC0CB',
    '#F5F5DC',
    '#E0FFFF',
    '#FFFFFF',
    '#A9A9A9',
];

const resolveNationColorIndex = (value: number | string | boolean): number | null => {
    let index: number;
    if (typeof value === 'boolean') {
        index = value ? 1 : 0;
    } else if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            return null;
        }
        index = Math.trunc(value);
    } else {
        if (!/^(?:0|[1-9]\d*|-[1-9]\d*)$/.test(value)) {
            return null;
        }
        index = Number(value);
    }
    return Number.isSafeInteger(index) && index >= 0 && index < NATION_COLORS.length ? index : null;
};

const ARGS_SCHEMA = z.object({
    colorType: z
        .union([z.number(), z.string(), z.boolean()])
        .refine((value) => resolveNationColorIndex(value) !== null),
});
export type ChangeFlagArgs = z.infer<typeof ARGS_SCHEMA>;

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, ChangeFlagArgs> {
    public readonly key = 'che_국기변경';
    public readonly name = ACTION_NAME;
    public readonly countsAsInheritanceActiveAction = true;

    parseArgs(raw: unknown): ChangeFlagArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: ChangeFlagArgs): Constraint[] {
        return [
            occupiedCity(),
            beChief(),
            suppliedCity(),
            reqNationAuxValue(`can_${ACTION_NAME}`, 0, '>', 0, '더이상 변경이 불가능합니다.'),
        ];
    }

    buildConstraints(_ctx: ConstraintContext, _args: ChangeFlagArgs): Constraint[] {
        return [
            occupiedCity(),
            beChief(),
            suppliedCity(),
            reqNationAuxValue(`can_${ACTION_NAME}`, 0, '>', 0, '더이상 변경이 불가능합니다.'),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: ChangeFlagArgs
    ): GeneralActionOutcome<TriggerState> {
        const { general, nation } = context;
        if (!nation) {
            return { effects: [createLogEffect('국가 정보가 없습니다.', { scope: LogScope.GENERAL })] };
        }

        const colorIndex = resolveNationColorIndex(args.colorType);
        if (colorIndex === null) {
            return { effects: [] };
        }
        const color = NATION_COLORS[colorIndex];
        const generalName = general.name;
        const nationName = nation.name;

        const josaYi = JosaUtil.pick(generalName, '이');
        const josaYiNation = JosaUtil.pick(nationName, '이');

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createNationPatchEffect(
                {
                    color: color!,
                    meta: {
                        ...nation.meta,
                        [`can_${ACTION_NAME}`]: 0,
                    },
                },
                nation.id
            ),
            // Global Action Log
            createLogEffect(
                `<Y>${generalName}</>${josaYi} <span style='color:${color};'><b>국기</b></span>를 변경하였습니다`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.SUMMARY,
                    format: LogFormat.MONTH,
                }
            ),
            // Global History Log
            createLogEffect(
                `<S><b>【${ACTION_NAME}】</b></><D><b>${nationName}</b></>${josaYiNation} <span style='color:${color};'><b>국기</b></span>를 변경하였습니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            // Actor Nation History Log
            createLogEffect(
                `<Y>${generalName}</>${josaYi} <span style='color:${color};'><b>국기</b></span>를 변경하였습니다`,
                {
                    scope: LogScope.NATION,
                    nationId: nation.id,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            createLogEffect(`<span style='color:${color};'><b>국기</b></span>를 변경`, {
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }),
            // General Action Log
            createLogEffect(`<span style='color:${color};'><b>국기</b></span>를 변경하였습니다`, {
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
    key: 'che_국기변경',
    category: '국가',
    reqArg: true,
    availabilityArgs: { colorType: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
