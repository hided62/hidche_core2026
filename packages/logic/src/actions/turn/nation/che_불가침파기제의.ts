import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    allowDiplomacyBetweenStatus,
    beChief,
    existsDestNation,
    notBeNeutral,
    occupiedCity,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { NationTurnCommandSpec } from './index.js';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    destNationId: z.preprocess(
        (value) => (typeof value === 'number' ? Math.floor(value) : value),
        z.number().int().positive()
    ),
});
export type NonAggressionCancelProposalArgs = z.infer<typeof ARGS_SCHEMA>;

const ACTION_NAME = '불가침 파기 제의';
const DIPLOMACY_NON_AGGRESSION = 7;

// 불가침 파기 제의를 처리하는 국가 커맨드.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, NonAggressionCancelProposalArgs> {
    public readonly key = 'che_불가침파기제의';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): NonAggressionCancelProposalArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: NonAggressionCancelProposalArgs): Constraint[] {
        return [beChief(), notBeNeutral(), occupiedCity(), suppliedCity()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: NonAggressionCancelProposalArgs): Constraint[] {
        return [
            beChief(),
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            existsDestNation(),
            allowDiplomacyBetweenStatus([DIPLOMACY_NON_AGGRESSION], '불가침 중인 상대국에게만 가능합니다.'),
        ];
    }

    resolve(
        _context: GeneralActionResolveContext<TriggerState>,
        args: NonAggressionCancelProposalArgs
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

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_불가침파기제의',
    category: '외교',
    reqArg: true,
    availabilityArgs: { destNationId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
