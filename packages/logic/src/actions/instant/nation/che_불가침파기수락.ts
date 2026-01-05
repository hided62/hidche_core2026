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

export interface NonAggressionCancelAcceptArgs {
    destNationId: number;
    destGeneralId: number;
}

const ACTION_NAME = '불가침 파기 수락';
const DIPLOMACY_NEUTRAL = 2;
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

// 불가침 파기 수락은 메시지와 연결되는 즉시 국가 커맨드로 사용한다.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, NonAggressionCancelAcceptArgs> {
    public readonly key = 'che_불가침파기수락';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): NonAggressionCancelAcceptArgs | null {
        const data = raw as { destNationId?: unknown; destGeneralId?: unknown };
        const destNationId = parseNationId(data?.destNationId);
        const destGeneralId = parseGeneralId(data?.destGeneralId);
        if (destNationId === null || destGeneralId === null) {
            return null;
        }
        return { destNationId, destGeneralId };
    }

    buildConstraints(_ctx: ConstraintContext, _args: NonAggressionCancelAcceptArgs): Constraint[] {
        return [
            beChief(),
            notBeNeutral(),
            existsDestNation(),
            existsDestGeneral(),
            destGeneralInDestNation(),
            notSameDestGeneral(),
            allowDiplomacyBetweenStatus([DIPLOMACY_NON_AGGRESSION], '불가침 중인 상대국에게만 가능합니다.'),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: NonAggressionCancelAcceptArgs
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
                createLogEffect(`${ACTION_NAME}을 실행했습니다. (국가 ${args.destNationId})`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }),
            ],
        };
    }
}
