import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    allowDiplomacyBetweenStatus,
    beChief,
    destGeneralInDestNation,
    existsDestGeneral,
    existsDestNation,
    notBeNeutral,
} from '@sammo-ts/logic/constraints/presets.js';
import { allow, unknownOrDeny } from '@sammo-ts/logic/constraints/helpers.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { createDiplomacyPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';

export interface StopWarAcceptArgs {
    destNationId: number;
    destGeneralId: number;
}

const ACTION_NAME = '종전 수락';
const DIPLOMACY_NEUTRAL = 2;

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

// 종전 수락은 메시지와 연결되는 즉시 국가 커맨드로 사용한다.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, StopWarAcceptArgs> {
    public readonly key = 'che_종전수락';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): StopWarAcceptArgs | null {
        const data = raw as { destNationId?: unknown; destGeneralId?: unknown };
        const destNationId = parseNationId(data?.destNationId);
        const destGeneralId = parseGeneralId(data?.destGeneralId);
        if (destNationId === null || destGeneralId === null) {
            return null;
        }
        return { destNationId, destGeneralId };
    }

    buildConstraints(_ctx: ConstraintContext, _args: StopWarAcceptArgs): Constraint[] {
        return [
            beChief(),
            notBeNeutral(),
            existsDestNation(),
            existsDestGeneral(),
            destGeneralInDestNation(),
            notSameDestGeneral(),
            allowDiplomacyBetweenStatus([0, 1], '상대국과 선포, 전쟁중이지 않습니다.'),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: StopWarAcceptArgs
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

        const nationName = context.nation?.name ?? `국가${nationId}`;
        const destNationName =
            (context as { destNation?: { name?: string } }).destNation?.name ?? `국가${args.destNationId}`;
        const generalName = context.general.name;
        const josaYiGeneral = JosaUtil.pick(generalName, '이');
        const josaYiNation = JosaUtil.pick(nationName, '이');
        const josaWa = JosaUtil.pick(destNationName, '와');

        return {
            effects: [
                createDiplomacyPatchEffect(nationId, args.destNationId, {
                    state: DIPLOMACY_NEUTRAL,
                    term: 0,
                }),
                createDiplomacyPatchEffect(args.destNationId, nationId, {
                    state: DIPLOMACY_NEUTRAL,
                    term: 0,
                }),
                createLogEffect(`<D><b>${destNationName}</b></>${josaWa} 종전에 합의했습니다.`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.PLAIN,
                }),
                createLogEffect(`<D><b>${destNationName}</b></>${josaWa} 종전 수락`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }),
                createLogEffect(
                    `<Y>${generalName}</>${josaYiGeneral} <D><b>${destNationName}</b></>${josaWa} <M>종전 합의</> 하였습니다.`,
                    {
                        scope: LogScope.SYSTEM,
                        category: LogCategory.ACTION,
                        format: LogFormat.PLAIN,
                    }
                ),
                createLogEffect(
                    `<Y><b>【종전】</b></><D><b>${nationName}</b></>${josaYiNation} <D><b>${destNationName}</b></>${josaWa} <M>종전 합의</> 하였습니다.`,
                    {
                        scope: LogScope.SYSTEM,
                        category: LogCategory.HISTORY,
                        format: LogFormat.YEAR_MONTH,
                    }
                ),
                createLogEffect(`<D><b>${destNationName}</b></>${josaWa} 종전`, {
                    scope: LogScope.NATION,
                    nationId,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }),
                createLogEffect(`<D><b>${nationName}</b></>${josaWa} 종전에 성공했습니다.`, {
                    scope: LogScope.GENERAL,
                    generalId: args.destGeneralId,
                    category: LogCategory.ACTION,
                    format: LogFormat.PLAIN,
                }),
                createLogEffect(`<D><b>${nationName}</b></>${josaWa} 종전 성공`, {
                    scope: LogScope.GENERAL,
                    generalId: args.destGeneralId,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }),
                createLogEffect(`<D><b>${nationName}</b></>${josaWa} 종전`, {
                    scope: LogScope.NATION,
                    nationId: args.destNationId,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }),
            ],
        };
    }
}
