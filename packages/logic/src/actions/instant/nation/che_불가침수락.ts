import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    beChief,
    destGeneralInDestNation,
    disallowDiplomacyBetweenStatus,
    existsDestGeneral,
    existsDestNation,
    notBeNeutral,
    occupiedCity,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import { allow, unknownOrDeny } from '@sammo-ts/logic/constraints/helpers.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { createDiplomacyPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';

export interface NonAggressionAcceptArgs {
    destNationId: number;
    destGeneralId: number;
    year: number;
    month: number;
}

export interface NonAggressionAcceptContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    currentYear: number;
    currentMonth: number;
}

const ACTION_NAME = '불가침 수락';
const DIPLOMACY_NON_AGGRESSION = 7;

const parseNationId = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw > 0 ? Math.floor(raw) : null;
};

const parseGeneralId = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw > 0 ? Math.floor(raw) : null;
};

const parseYear = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw >= 0 ? Math.floor(raw) : null;
};

const parseMonth = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    const month = Math.floor(raw);
    return month >= 1 && month <= 12 ? month : null;
};

const resolveMonthIndex = (year: number, month: number): number => year * 12 + month - 1;

const requireFutureTerm = (): Constraint => ({
    name: 'RequireNonAggressionFutureTerm',
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
        const targetMonth = yearValue * 12 + monthValue;
        if (targetMonth <= currentMonth) {
            return {
                kind: 'deny',
                reason: '이미 기한이 지났습니다.',
            };
        }
        return allow();
    },
});

const notSameDestGeneral = (): Constraint => ({
    name: 'NotSameDestGeneral',
    requires: () => [{ kind: 'arg', key: 'destGeneralId' }],
    test: (ctx) => {
        const destGeneralId = ctx.args.destGeneralId;
        if (typeof destGeneralId !== 'number') {
            return unknownOrDeny(ctx, [{ kind: 'arg', key: 'destGeneralId' }], '장수 정보가 없습니다.');
        }
        if (destGeneralId === ctx.actorId) {
            return { kind: 'deny', reason: '대상이 올바르지 않습니다.' };
        }
        return allow();
    },
});

// 불가침 수락은 메시지와 연결되는 즉시 국가 커맨드로 사용한다.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, NonAggressionAcceptArgs, NonAggressionAcceptContext<TriggerState>> {
    public readonly key = 'che_불가침수락';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): NonAggressionAcceptArgs | null {
        const data = raw as {
            destNationId?: unknown;
            destGeneralId?: unknown;
            year?: unknown;
            month?: unknown;
        };
        const destNationId = parseNationId(data?.destNationId);
        const destGeneralId = parseGeneralId(data?.destGeneralId);
        const year = parseYear(data?.year);
        const month = parseMonth(data?.month);
        if (destNationId === null || destGeneralId === null || year === null || month === null) {
            return null;
        }
        return { destNationId, destGeneralId, year, month };
    }

    buildConstraints(_ctx: ConstraintContext, _args: NonAggressionAcceptArgs): Constraint[] {
        return [
            beChief(),
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            existsDestNation(),
            existsDestGeneral(),
            destGeneralInDestNation(),
            notSameDestGeneral(),
            requireFutureTerm(),
            disallowDiplomacyBetweenStatus({
                0: '아국과 이미 교전중입니다.',
                1: '아국과 이미 선포중입니다.',
            }),
        ];
    }

    resolve(
        context: NonAggressionAcceptContext<TriggerState>,
        args: NonAggressionAcceptArgs
    ): GeneralActionOutcome<TriggerState> {
        const nationId = context.nation?.id;
        if (nationId === undefined || nationId <= 0) {
            return {
                effects: [
                    createLogEffect(`${ACTION_NAME}을 준비했지만 국가 정보가 없습니다.`, {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        format: LogFormat.MONTH,
                    }),
                ],
            };
        }

        const currentMonth = resolveMonthIndex(context.currentYear, context.currentMonth);
        const targetMonth = args.year * 12 + args.month;
        const term = Math.max(0, targetMonth - currentMonth);

        return {
            effects: [
                createDiplomacyPatchEffect(nationId, args.destNationId, {
                    state: DIPLOMACY_NON_AGGRESSION,
                    term,
                }),
                createDiplomacyPatchEffect(args.destNationId, nationId, {
                    state: DIPLOMACY_NON_AGGRESSION,
                    term,
                }),
                createLogEffect(`${ACTION_NAME}을 실행했습니다. (국가 ${args.destNationId})`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }),
            ],
        };
    }
}
