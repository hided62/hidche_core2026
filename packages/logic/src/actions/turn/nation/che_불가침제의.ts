import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    beChief,
    differentDestNation,
    disallowDiplomacyBetweenStatus,
    existsDestNation,
    notBeNeutral,
} from '@sammo-ts/logic/constraints/presets.js';
import { allow, unknownOrDeny } from '@sammo-ts/logic/constraints/helpers.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    destNationId: z.preprocess(
        (value) => (typeof value === 'number' ? Math.floor(value) : value),
        z.number().int().positive()
    ),
    year: z.preprocess((value) => (typeof value === 'number' ? Math.floor(value) : value), z.number().int().min(0)),
    month: z.preprocess(
        (value) => (typeof value === 'number' ? Math.floor(value) : value),
        z.number().int().min(1).max(12)
    ),
});
export type NonAggressionProposalArgs = z.infer<typeof ARGS_SCHEMA>;

const ACTION_NAME = '불가침 제의';
const MIN_TERM_MONTHS = 6;

const resolveMonthIndex = (year: number, month: number): number => year * 12 + month - 1;

const requireMinimumTerm = (minMonths: number): Constraint => ({
    name: 'RequireNonAggressionMinimumTerm',
    requires: () => [
        { kind: 'arg', key: 'year' },
        { kind: 'arg', key: 'month' },
        { kind: 'env', key: 'year' },
        { kind: 'env', key: 'month' },
    ],
    test: (ctx) => {
        const yearValue = typeof ctx.args.year === 'number' ? ctx.args.year : null;
        const monthValue = typeof ctx.args.month === 'number' ? ctx.args.month : null;
        const envYearValue = typeof ctx.env.year === 'number' ? ctx.env.year : null;
        const envMonthValue = typeof ctx.env.month === 'number' ? ctx.env.month : null;
        const missing = [];

        if (yearValue === null) {
            missing.push({ kind: 'arg', key: 'year' } as const);
        }
        if (monthValue === null) {
            missing.push({ kind: 'arg', key: 'month' } as const);
        }
        if (envYearValue === null) {
            missing.push({ kind: 'env', key: 'year' } as const);
        }
        if (envMonthValue === null) {
            missing.push({ kind: 'env', key: 'month' } as const);
        }

        if (
            missing.length > 0 ||
            yearValue === null ||
            monthValue === null ||
            envYearValue === null ||
            envMonthValue === null
        ) {
            return unknownOrDeny(ctx, missing, '기한 정보가 없습니다.');
        }

        const currentMonth = resolveMonthIndex(envYearValue, envMonthValue);
        const targetMonth = resolveMonthIndex(yearValue, monthValue);
        if (targetMonth < currentMonth + minMonths) {
            return {
                kind: 'deny',
                reason: `기한은 ${minMonths}개월 이상이어야 합니다.`,
            };
        }
        return allow();
    },
});

// 불가침 제의를 처리하는 국가 커맨드.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, NonAggressionProposalArgs> {
    public readonly key = 'che_불가침제의';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): NonAggressionProposalArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: NonAggressionProposalArgs): Constraint[] {
        return [beChief(), notBeNeutral()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: NonAggressionProposalArgs): Constraint[] {
        return [
            beChief(),
            notBeNeutral(),
            existsDestNation(),
            differentDestNation(),
            requireMinimumTerm(MIN_TERM_MONTHS),
            disallowDiplomacyBetweenStatus({
                0: '아국과 이미 교전중입니다.',
                1: '아국과 이미 선포중입니다.',
            }),
        ];
    }

    resolve(
        _context: GeneralActionResolveContext<TriggerState>,
        args: NonAggressionProposalArgs
    ): GeneralActionOutcome<TriggerState> {
        return {
            effects: [
                createLogEffect(`${ACTION_NAME}을 준비했습니다. (국가 ${args.destNationId})`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }),
            ],
        };
    }
}

// 예약 턴 실행에 필요한 날짜 정보를 제공한다.
export const actionContextBuilder: ActionContextBuilder = (base, options) => ({
    ...base,
    currentYear: options.world.currentYear,
    currentMonth: options.world.currentMonth,
});

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_불가침제의',
    category: '외교',
    reqArg: true,
    availabilityArgs: { destNationId: 0, year: 0, month: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
