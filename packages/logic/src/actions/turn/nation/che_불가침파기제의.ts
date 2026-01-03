import type { GeneralTriggerState } from '../../../domain/entities.js';
import type { Constraint, ConstraintContext } from '../../../constraints/types.js';
import {
    allowDiplomacyBetweenStatus,
    beChief,
    existsDestNation,
    notBeNeutral,
    occupiedCity,
    suppliedCity,
} from '../../../constraints/presets.js';
import type { GeneralActionDefinition } from '../../definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '../../engine.js';
import { createLogEffect } from '../../engine.js';
import { LogCategory, LogFormat, LogScope } from '../../../logging/types.js';
import type { TurnCommandEnv } from '../commandEnv.js';
import { defaultActionContextBuilder } from '../actionContext.js';
import type { NationTurnCommandSpec } from './index.js';

export interface NonAggressionCancelProposalArgs {
    destNationId: number;
}

const ACTION_NAME = '불가침 파기 제의';
const DIPLOMACY_NON_AGGRESSION = 7;

const parseNationId = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw > 0 ? Math.floor(raw) : null;
};

// 불가침 파기 제의를 처리하는 국가 커맨드.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements
        GeneralActionDefinition<TriggerState, NonAggressionCancelProposalArgs>
{
    public readonly key = 'che_불가침파기제의';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): NonAggressionCancelProposalArgs | null {
        const data = raw as { destNationId?: unknown };
        const destNationId = parseNationId(data?.destNationId);
        if (destNationId === null) {
            return null;
        }
        return { destNationId };
    }

    buildConstraints(
        _ctx: ConstraintContext,
        _args: NonAggressionCancelProposalArgs
    ): Constraint[] {
        return [
            beChief(),
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            existsDestNation(),
            allowDiplomacyBetweenStatus(
                [DIPLOMACY_NON_AGGRESSION],
                '불가침 중인 상대국에게만 가능합니다.'
            ),
        ];
    }

    resolve(
        _context: GeneralActionResolveContext<TriggerState>,
        args: NonAggressionCancelProposalArgs
    ): GeneralActionOutcome<TriggerState> {
        return {
            effects: [
                createLogEffect(
                    `${ACTION_NAME}을 준비했습니다. (국가 ${args.destNationId})`,
                    {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        format: LogFormat.MONTH,
                    }
                ),
            ],
        };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_불가침파기제의',
    category: '외교',
    reqArg: true,
    args: { destNationId: 0 },
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
