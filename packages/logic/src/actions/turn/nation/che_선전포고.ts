import type { GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    beChief,
    disallowDiplomacyBetweenStatus,
    existsDestNation,
    nearNation,
    notBeNeutral,
    occupiedCity,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { createDiplomacyPatchEffect, createLogEffect, createMessageEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { JosaUtil } from '@sammo-ts/common';
import type { NationTurnCommandSpec } from './index.js';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';
import { resolveMessageTargetIcon } from '@sammo-ts/logic/messages/message.js';

const ARGS_SCHEMA = z.object({
    destNationId: z.number().int().positive(),
});
export type DeclareWarArgs = z.infer<typeof ARGS_SCHEMA>;

interface DeclareWarResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destNation: Nation;
    currentYear: number;
    currentMonth: number;
    messageTime: Date;
    messageSharedIconBaseUrl?: string;
}

const ACTION_NAME = '선전포고';
// legacy 규칙: 선전포고 상태는 24턴 유지.
const DIPLOMACY_DECLARE = 1;
const DECLARE_TERM = 24;

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, DeclareWarArgs, DeclareWarResolveContext<TriggerState>> {
    public readonly key = 'che_선전포고';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): DeclareWarArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: DeclareWarArgs): Constraint[] {
        const relYear = typeof _ctx.env.relYear === 'number' ? _ctx.env.relYear : 0;
        return [
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            beChief(),
            {
                name: 'reqEnvValue',
                requires: () => [],
                test: () => {
                    if (relYear >= 1) return { kind: 'allow' };
                    return { kind: 'deny', reason: '초반제한 해제 2년전부터 가능합니다.' };
                },
            },
        ];
    }

    buildConstraints(_ctx: ConstraintContext, _args: DeclareWarArgs): Constraint[] {
        const relYear = typeof _ctx.env.relYear === 'number' ? _ctx.env.relYear : 0;

        return [
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            beChief(),
            existsDestNation(),
            nearNation(),
            // legacy: startYear + 1. 0-indexed relYear로는 1
            {
                name: 'reqEnvValue',
                requires: () => [],
                test: () => {
                    if (relYear >= 1) return { kind: 'allow' };
                    return { kind: 'deny', reason: '초반제한 해제 2년전부터 가능합니다.' };
                },
            },
            disallowDiplomacyBetweenStatus({
                0: '아국과 이미 교전중입니다.',
                1: '아국과 이미 선포중입니다.',
                7: '불가침국입니다.',
            }),
        ];
    }

    resolve(context: DeclareWarResolveContext<TriggerState>, args: DeclareWarArgs): GeneralActionOutcome<TriggerState> {
        const nationId = context.nation?.id;
        if (nationId === undefined || nationId <= 0 || !context.destNation) {
            return {
                effects: [
                    createLogEffect(`${ACTION_NAME}을 준비했지만 국가(또는 대상 국가) 정보가 없습니다.`, {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        format: LogFormat.MONTH,
                    }),
                ],
            };
        }

        const nationName = context.nation?.name ?? '아국';
        const destNationName = context.destNation.name;
        const generalName = context.general.name;
        const josaYiGeneral = JosaUtil.pick(generalName, '이');
        const josaYiNation = JosaUtil.pick(nationName, '이');

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createDiplomacyPatchEffect(nationId, args.destNationId, {
                state: DIPLOMACY_DECLARE,
                term: DECLARE_TERM,
            }),
            createDiplomacyPatchEffect(args.destNationId, nationId, {
                state: DIPLOMACY_DECLARE,
                term: DECLARE_TERM,
            }),
            // General Action Log
            createLogEffect(`<D><b>${destNationName}</b></>에 선전 포고 했습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            }),
            // General History Log
            createLogEffect(`<D><b>${destNationName}</b></>에 선전 포고`, {
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }),
            // Actor Nation History Log
            createLogEffect(`<Y>${generalName}</>${josaYiGeneral} <D><b>${destNationName}</b></>에 선전 포고`, {
                scope: LogScope.NATION,
                nationId: nationId,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }),
            // Target Nation History Log
            createLogEffect(`<D><b>${nationName}</b></>의 <Y>${generalName}</>${josaYiGeneral} 아국에 선전 포고`, {
                scope: LogScope.NATION,
                nationId: args.destNationId,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
                // Ref는 actor logger를 applyDB로 flush한 뒤 상대국 logger를 따로 flush한다.
                legacyFlushGroup: 1,
            }),
            // Global Action Log
            createLogEffect(
                `<Y>${generalName}</>${josaYiGeneral} <D><b>${destNationName}</b></>에 <M>선전 포고</> 하였습니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.SUMMARY,
                    format: LogFormat.MONTH,
                }
            ),
            // Global History Log
            createLogEffect(
                `<R><b>【선포】</b></><D><b>${nationName}</b></>${josaYiNation} <D><b>${destNationName}</b></>에 선전 포고 하였습니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            createMessageEffect({
                msgType: 'national',
                src: {
                    generalId: context.general.id,
                    generalName,
                    nationId,
                    nationName,
                    color: context.nation?.color ?? '',
                    icon: resolveMessageTargetIcon(context.general, context.messageSharedIconBaseUrl),
                },
                dest: {
                    generalId: 0,
                    generalName: '',
                    nationId: args.destNationId,
                    nationName: destNationName,
                    color: context.destNation.color,
                    icon: resolveMessageTargetIcon(null, context.messageSharedIconBaseUrl),
                },
                text: `【외교】${context.currentYear}년 ${context.currentMonth}월:${nationName}에서 ${destNationName}에 선전포고`,
                time: context.messageTime,
                validUntil: new Date('9999-12-31T00:00:00.000Z'),
                option: {},
            }),
        ];

        return { effects };
    }
}

// 예약 턴 실행에 필요한 대상 국가 정보를 구성한다.
export const actionContextBuilder: ActionContextBuilder<DeclareWarArgs> = (base, options) => {
    const destNationId = options.actionArgs.destNationId;
    if (typeof destNationId !== 'number') {
        return null;
    }
    const worldRef = options.worldRef;
    if (!worldRef) {
        return null;
    }
    const destNation = worldRef.getNationById(destNationId);
    if (!destNation) {
        return null;
    }
    return {
        ...base,
        destNation,
        currentYear: options.world.currentYear,
        currentMonth: options.world.currentMonth,
        messageSharedIconBaseUrl: options.messageSharedIconBaseUrl,
        messageTime: options.gameNow ?? base.general.turnTime,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_선전포고',
    category: '외교',
    reqArg: true,
    availabilityArgs: { destNationId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
