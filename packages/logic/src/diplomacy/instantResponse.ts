import { JosaUtil } from '@sammo-ts/common';

import {
    createDiplomacyPatchEffect,
    createLogEffect,
    createNationPatchEffect,
    type GeneralActionEffect,
} from '../actions/engine.js';
import { allow, unknownOrDeny } from '../constraints/helpers.js';
import type { Constraint } from '../constraints/types.js';
import type { GeneralTriggerState, Nation, TriggerValue } from '../domain/entities.js';
import { LogCategory, LogFormat, LogScope } from '../logging/types.js';
import { DIPLOMACY_STATE } from './constants.js';

export type InstantDiplomacyResponseAction = 'noAggression' | 'cancelNA' | 'stopWar';

export interface InstantDiplomacyResponseContext {
    actor: {
        id: number;
        name: string;
        nationId: number;
    };
    actorNation: Nation;
    proposer: {
        id: number;
        name: string;
        nationId: number;
    };
    proposerNation: Nation;
    currentYear: number;
    currentMonth: number;
}

export interface InstantDiplomacyResponseArgs {
    action: InstantDiplomacyResponseAction;
    treatyYear?: number;
    treatyMonth?: number;
}

export const destGeneralBelongsToDestNation = (): Constraint => ({
    name: 'destGeneralBelongsToDestNation',
    requires: (ctx) => {
        const requirements = [];
        if (ctx.destGeneralId !== undefined) {
            requirements.push({ kind: 'destGeneral', id: ctx.destGeneralId } as const);
        }
        if (ctx.destNationId !== undefined) {
            requirements.push({ kind: 'destNation', id: ctx.destNationId } as const);
        }
        return requirements;
    },
    test: (ctx, view) => {
        if (ctx.destGeneralId === undefined || ctx.destNationId === undefined) {
            return unknownOrDeny(ctx, [], '제의 장수가 국가 소속이 아닙니다');
        }
        const generalRequirement = { kind: 'destGeneral', id: ctx.destGeneralId } as const;
        const nationRequirement = { kind: 'destNation', id: ctx.destNationId } as const;
        if (!view.has(generalRequirement) || !view.has(nationRequirement)) {
            return unknownOrDeny(
                ctx,
                [generalRequirement, nationRequirement].filter((requirement) => !view.has(requirement)),
                '제의 장수가 국가 소속이 아닙니다'
            );
        }
        const destGeneral = view.get(generalRequirement) as { nationId?: unknown } | null;
        return destGeneral?.nationId === ctx.destNationId
            ? allow()
            : { kind: 'deny', reason: '제의 장수가 국가 소속이 아닙니다' };
    },
});

export interface InstantDiplomacyResponseResolution<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    actionKey: 'che_불가침수락' | 'che_불가침파기수락' | 'che_종전수락';
    diplomacyDetail: string;
    effects: GeneralActionEffect<TriggerState>[];
    refreshFront: boolean;
}

const resolveMonthIndex = (year: number, month: number): number => year * 12 + month - 1;

const buildNonAggressionEffects = <TriggerState extends GeneralTriggerState>(
    context: InstantDiplomacyResponseContext,
    treatyYear: number,
    treatyMonth: number
): GeneralActionEffect<TriggerState>[] => {
    const actorNation = context.actorNation;
    const proposerNation = context.proposerNation;
    const actorNationName = actorNation.name;
    const proposerNationName = proposerNation.name;
    const actorJosaWa = JosaUtil.pick(actorNationName, '와');
    const proposerJosaWa = JosaUtil.pick(proposerNationName, '와');
    const proposerMeta = { ...proposerNation.meta };
    const recvAssist =
        proposerMeta.recv_assist &&
        typeof proposerMeta.recv_assist === 'object' &&
        !Array.isArray(proposerMeta.recv_assist)
            ? (proposerMeta.recv_assist as Record<string, TriggerValue>)
            : {};
    const respAssist =
        proposerMeta.resp_assist &&
        typeof proposerMeta.resp_assist === 'object' &&
        !Array.isArray(proposerMeta.resp_assist)
            ? { ...(proposerMeta.resp_assist as Record<string, TriggerValue>) }
            : ({} as Record<string, TriggerValue>);
    const assistKey = `n${actorNation.id}`;
    const recvEntry = recvAssist[assistKey];
    const recvAmount =
        Array.isArray(recvEntry) && typeof recvEntry[1] === 'number' && Number.isFinite(recvEntry[1])
            ? recvEntry[1]
            : 0;
    respAssist[assistKey] = [actorNation.id, recvAmount];

    const currentMonth = resolveMonthIndex(context.currentYear, context.currentMonth);
    const targetMonth = treatyYear * 12 + treatyMonth;
    const term = targetMonth - currentMonth;

    return [
        createDiplomacyPatchEffect(actorNation.id, proposerNation.id, {
            state: DIPLOMACY_STATE.NON_AGGRESSION,
            term,
        }),
        createDiplomacyPatchEffect(proposerNation.id, actorNation.id, {
            state: DIPLOMACY_STATE.NON_AGGRESSION,
            term,
        }),
        createNationPatchEffect(
            {
                meta: {
                    ...proposerMeta,
                    resp_assist: respAssist,
                },
            },
            proposerNation.id
        ),
        createLogEffect(
            `<D><b>${proposerNationName}</b></>${proposerJosaWa} ${treatyYear}년 ${treatyMonth}월까지 불가침 성공`,
            {
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                generalId: context.actor.id,
                format: LogFormat.YEAR_MONTH,
            }
        ),
        createLogEffect(
            `<D><b>${proposerNationName}</b></>${proposerJosaWa} <C>${treatyYear}</>년 <C>${treatyMonth}</>월까지 불가침에 성공했습니다.`,
            {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: context.actor.id,
                format: LogFormat.PLAIN,
            }
        ),
        createLogEffect(
            `<D><b>${actorNationName}</b></>${actorJosaWa} ${treatyYear}년 ${treatyMonth}월까지 불가침 성공`,
            {
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                generalId: context.proposer.id,
                format: LogFormat.YEAR_MONTH,
            }
        ),
        createLogEffect(
            `<D><b>${actorNationName}</b></>${actorJosaWa} <C>${treatyYear}</>년 <C>${treatyMonth}</>월까지 불가침에 성공했습니다.`,
            {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: context.proposer.id,
                format: LogFormat.PLAIN,
            }
        ),
    ];
};

const buildCancelNonAggressionEffects = <TriggerState extends GeneralTriggerState>(
    context: InstantDiplomacyResponseContext
): GeneralActionEffect<TriggerState>[] => {
    const actorNation = context.actorNation;
    const proposerNation = context.proposerNation;
    const actorNationName = actorNation.name;
    const proposerNationName = proposerNation.name;
    const actorName = context.actor.name;
    const actorJosaYi = JosaUtil.pick(actorName, '이');
    const actorNationJosaYi = JosaUtil.pick(actorNationName, '이');
    const actorNationJosaWa = JosaUtil.pick(actorNationName, '와');
    const proposerJosaWa = JosaUtil.pick(proposerNationName, '와');

    return [
        createDiplomacyPatchEffect(actorNation.id, proposerNation.id, {
            state: DIPLOMACY_STATE.TRADE,
            term: 0,
        }),
        createDiplomacyPatchEffect(proposerNation.id, actorNation.id, {
            state: DIPLOMACY_STATE.TRADE,
            term: 0,
        }),
        createLogEffect(`<D><b>${proposerNationName}</b></>${proposerJosaWa}의 불가침 파기 수락`, {
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
            generalId: context.actor.id,
            format: LogFormat.YEAR_MONTH,
        }),
        createLogEffect(`<D><b>${proposerNationName}</b></>${proposerJosaWa}의 불가침을 파기했습니다.`, {
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            generalId: context.actor.id,
            format: LogFormat.PLAIN,
        }),
        createLogEffect(
            `<Y><b>【파기】</b></><D><b>${actorNationName}</b></>${actorNationJosaYi} <D><b>${proposerNationName}</b></>${proposerJosaWa}의 불가침 조약을 <M>파기</> 하였습니다.`,
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }
        ),
        createLogEffect(
            `<Y>${actorName}</>${actorJosaYi} <D><b>${proposerNationName}</b></>${proposerJosaWa}의 불가침 조약을 <M>파기</> 하였습니다.`,
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.SUMMARY,
                format: LogFormat.MONTH,
            }
        ),
        createLogEffect(`<D><b>${actorNationName}</b></>${actorNationJosaWa}의 불가침 파기 성공`, {
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
            generalId: context.proposer.id,
            format: LogFormat.YEAR_MONTH,
        }),
        createLogEffect(`<D><b>${actorNationName}</b></>${actorNationJosaWa}의 불가침 파기에 성공했습니다.`, {
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            generalId: context.proposer.id,
            format: LogFormat.PLAIN,
        }),
    ];
};

const buildStopWarEffects = <TriggerState extends GeneralTriggerState>(
    context: InstantDiplomacyResponseContext
): GeneralActionEffect<TriggerState>[] => {
    const actorNation = context.actorNation;
    const proposerNation = context.proposerNation;
    const actorNationName = actorNation.name;
    const proposerNationName = proposerNation.name;
    const actorName = context.actor.name;
    const actorJosaYi = JosaUtil.pick(actorName, '이');
    const actorNationJosaYi = JosaUtil.pick(actorNationName, '이');
    const actorNationJosaWa = JosaUtil.pick(actorNationName, '와');
    const proposerJosaWa = JosaUtil.pick(proposerNationName, '와');

    return [
        createDiplomacyPatchEffect(actorNation.id, proposerNation.id, {
            state: DIPLOMACY_STATE.TRADE,
            term: 0,
        }),
        createDiplomacyPatchEffect(proposerNation.id, actorNation.id, {
            state: DIPLOMACY_STATE.TRADE,
            term: 0,
        }),
        createLogEffect(`<D><b>${proposerNationName}</b></>${proposerJosaWa} 종전 수락`, {
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
            generalId: context.actor.id,
            format: LogFormat.YEAR_MONTH,
        }),
        createLogEffect(`<D><b>${proposerNationName}</b></>${proposerJosaWa} 종전에 합의했습니다.`, {
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            generalId: context.actor.id,
            format: LogFormat.PLAIN,
        }),
        createLogEffect(`<D><b>${proposerNationName}</b></>${proposerJosaWa} 종전`, {
            scope: LogScope.NATION,
            nationId: actorNation.id,
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        }),
        createLogEffect(
            `<Y><b>【종전】</b></><D><b>${actorNationName}</b></>${actorNationJosaYi} <D><b>${proposerNationName}</b></>${proposerJosaWa} <M>종전 합의</> 하였습니다.`,
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }
        ),
        createLogEffect(
            `<Y>${actorName}</>${actorJosaYi} <D><b>${proposerNationName}</b></>${proposerJosaWa} <M>종전 합의</> 하였습니다.`,
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.SUMMARY,
                format: LogFormat.MONTH,
            }
        ),
        createLogEffect(`<D><b>${actorNationName}</b></>${actorNationJosaWa} 종전 성공`, {
            scope: LogScope.GENERAL,
            generalId: context.proposer.id,
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        }),
        createLogEffect(`<D><b>${actorNationName}</b></>${actorNationJosaWa} 종전에 성공했습니다.`, {
            scope: LogScope.GENERAL,
            generalId: context.proposer.id,
            category: LogCategory.ACTION,
            format: LogFormat.PLAIN,
        }),
        createLogEffect(`<D><b>${actorNationName}</b></>${actorNationJosaWa} 종전`, {
            scope: LogScope.NATION,
            nationId: proposerNation.id,
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        }),
    ];
};

export const resolveInstantDiplomacyResponse = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    context: InstantDiplomacyResponseContext,
    args: InstantDiplomacyResponseArgs
): InstantDiplomacyResponseResolution<TriggerState> => {
    if (args.action === 'noAggression') {
        if (
            typeof args.treatyYear !== 'number' ||
            !Number.isInteger(args.treatyYear) ||
            typeof args.treatyMonth !== 'number' ||
            !Number.isInteger(args.treatyMonth) ||
            args.treatyMonth < 1 ||
            args.treatyMonth > 12
        ) {
            throw new Error('Invalid non-aggression treaty term.');
        }
        return {
            actionKey: 'che_불가침수락',
            diplomacyDetail: `${args.treatyYear}년 ${args.treatyMonth}월까지 불가침 합의`,
            effects: buildNonAggressionEffects<TriggerState>(context, args.treatyYear, args.treatyMonth),
            refreshFront: false,
        };
    }

    if (args.action === 'cancelNA') {
        return {
            actionKey: 'che_불가침파기수락',
            diplomacyDetail: `${context.proposerNation.name}국과 불가침 파기 합의`,
            effects: buildCancelNonAggressionEffects<TriggerState>(context),
            refreshFront: false,
        };
    }

    return {
        actionKey: 'che_종전수락',
        diplomacyDetail: `${context.proposerNation.name}국과 종전 합의`,
        effects: buildStopWarEffects<TriggerState>(context),
        refreshFront: true,
    };
};
