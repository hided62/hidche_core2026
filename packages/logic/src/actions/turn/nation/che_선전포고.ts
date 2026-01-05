import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    beChief,
    disallowDiplomacyBetweenStatus,
    existsDestNation,
    notBeNeutral,
    occupiedCity,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { createDiplomacyPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { NationTurnCommandSpec } from './index.js';

export interface DeclareWarArgs {
    destNationId: number;
}

const ACTION_NAME = '선전포고';
// legacy 규칙: 선전포고 상태는 24턴 유지.
const DIPLOMACY_DECLARE = 1;
const DECLARE_TERM = 24;

const parseNationId = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw > 0 ? Math.floor(raw) : null;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, DeclareWarArgs> {
    public readonly key = 'che_선전포고';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): DeclareWarArgs | null {
        const data = raw as { destNationId?: unknown };
        const destNationId = parseNationId(data?.destNationId);
        if (destNationId === null) {
            return null;
        }
        return { destNationId };
    }

    buildConstraints(_ctx: ConstraintContext, _args: DeclareWarArgs): Constraint[] {
        return [
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            beChief(),
            existsDestNation(),
            disallowDiplomacyBetweenStatus({
                0: '아국과 이미 교전중입니다.',
                1: '아국과 이미 선포중입니다.',
                7: '불가침국입니다.',
            }),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: DeclareWarArgs
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
                    state: DIPLOMACY_DECLARE,
                    term: DECLARE_TERM,
                }),
                createDiplomacyPatchEffect(args.destNationId, nationId, {
                    state: DIPLOMACY_DECLARE,
                    term: DECLARE_TERM,
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

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_선전포고',
    category: '외교',
    reqArg: true,
    args: { destNationId: 0 },
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
