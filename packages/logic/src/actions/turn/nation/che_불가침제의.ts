import type { GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
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
import { createLogEffect, createMessageEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    destNationId: z.number().int().positive(),
    year: z.number().int().min(0),
    month: z.number().int().min(1).max(12),
});
export type NonAggressionProposalArgs = z.infer<typeof ARGS_SCHEMA>;

interface NonAggressionProposalContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destNation: Nation;
    messageValidMinutes: number;
    messageTime: Date;
}

const ACTION_NAME = '불가침 제의';
const MIN_TERM_MONTHS = 6;

const resolveMonthIndex = (year: number, month: number): number => year * 12 + month - 1;

const reqMinimumTreatyTerm = (minMonths: number): Constraint => ({
    name: 'reqMinimumTreatyTerm',
    requires: () => [
        { kind: 'arg', key: 'year' },
        { kind: 'arg', key: 'month' },
        { kind: 'env', key: 'year' },
        { kind: 'env', key: 'month' },
        { kind: 'env', key: 'startYear' },
    ],
    test: (ctx) => {
        const yearValue = typeof ctx.args.year === 'number' ? ctx.args.year : null;
        const monthValue = typeof ctx.args.month === 'number' ? ctx.args.month : null;
        const envYearValue = typeof ctx.env.year === 'number' ? ctx.env.year : null;
        const envMonthValue = typeof ctx.env.month === 'number' ? ctx.env.month : null;
        const startYearValue = typeof ctx.env.startYear === 'number' ? ctx.env.startYear : null;
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
        if (startYearValue === null) {
            missing.push({ kind: 'env', key: 'startYear' } as const);
        }

        if (
            missing.length > 0 ||
            yearValue === null ||
            monthValue === null ||
            envYearValue === null ||
            envMonthValue === null ||
            startYearValue === null
        ) {
            return unknownOrDeny(ctx, missing, '기한 정보가 없습니다.');
        }

        if (yearValue < startYearValue) {
            return {
                kind: 'deny',
                reason: '시작 연도보다 이전의 기한은 지정할 수 없습니다.',
            };
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
> implements GeneralActionDefinition<
    TriggerState,
    NonAggressionProposalArgs,
    NonAggressionProposalContext<TriggerState>
> {
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
            reqMinimumTreatyTerm(MIN_TERM_MONTHS),
            disallowDiplomacyBetweenStatus({
                0: '아국과 이미 교전중입니다.',
                1: '아국과 이미 선포중입니다.',
            }),
        ];
    }

    resolve(
        context: NonAggressionProposalContext<TriggerState>,
        args: NonAggressionProposalArgs
    ): GeneralActionOutcome<TriggerState> {
        const { general, nation, destNation } = context;
        if (!nation) {
            return { effects: [createLogEffect('국가 정보가 없습니다.')] };
        }
        const destNationName = destNation.name;
        const josaRo = JosaUtil.pick(nation.name, '로');
        const josaWa = JosaUtil.pick(nation.name, '와');
        const validUntil = new Date(context.messageTime.getTime() + context.messageValidMinutes * 60_000);
        return {
            effects: [
                createMessageEffect({
                    msgType: 'diplomacy',
                    src: {
                        generalId: general.id,
                        generalName: general.name,
                        nationId: nation.id,
                        nationName: nation.name,
                        color: nation.color,
                        icon: '',
                    },
                    dest: {
                        generalId: 0,
                        generalName: '',
                        nationId: destNation.id,
                        nationName: destNation.name,
                        color: destNation.color,
                        icon: '',
                    },
                    text: `${nation.name}${josaWa} ${args.year}년 ${args.month}월까지 불가침 제의 서신`,
                    time: context.messageTime,
                    validUntil,
                    option: { action: 'noAggression', year: args.year, month: args.month },
                }),
                createLogEffect(`<D><b>${destNationName}</b></>${josaRo} 불가침 제의 서신을 보냈습니다.`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }),
            ],
        };
    }
}

// 예약 턴 실행에 필요한 날짜 정보를 제공한다.
export const actionContextBuilder: ActionContextBuilder<NonAggressionProposalArgs> = (base, options) => {
    const destNation = options.worldRef?.getNationById(options.actionArgs.destNationId);
    if (!destNation) {
        return null;
    }
    return {
        ...base,
        destNation,
        messageTime: base.general.turnTime,
        messageValidMinutes: Math.max(30, Math.floor((options.world.tickSeconds / 60) * 3)),
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_불가침제의',
    category: '외교',
    reqArg: true,
    availabilityArgs: { destNationId: 0, year: 0, month: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
