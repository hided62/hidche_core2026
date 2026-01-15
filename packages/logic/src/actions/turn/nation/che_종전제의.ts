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
import { JosaUtil } from '@sammo-ts/common';

export interface StopWarProposalArgs {
    destNationId: number;
}

const ACTION_NAME = '종전 제의';

const parseNationId = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw > 0 ? Math.floor(raw) : null;
};

// 종전 제의를 처리하는 국가 커맨드.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, StopWarProposalArgs> {
    public readonly key = 'che_종전제의';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): StopWarProposalArgs | null {
        const data = raw as { destNationId?: unknown };
        const destNationId = parseNationId(data?.destNationId);
        if (destNationId === null) {
            return null;
        }
        return { destNationId };
    }

    buildConstraints(_ctx: ConstraintContext, _args: StopWarProposalArgs): Constraint[] {
        return [
            beChief(),
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            existsDestNation(),
            allowDiplomacyBetweenStatus([0, 1], '선포, 전쟁중인 상대국에게만 가능합니다.'),
        ];
    }

    resolve(
        _context: GeneralActionResolveContext<TriggerState>,
        args: StopWarProposalArgs
    ): GeneralActionOutcome<TriggerState> {
        const destNationName =
            (_context as { destNation?: { name?: string } }).destNation?.name ?? `국가${args.destNationId}`;
        const josaRo = JosaUtil.pick(destNationName, '로');
        return {
            effects: [
                createLogEffect(`<D><b>${destNationName}</b></>${josaRo} 종전 제의 서신을 보냈습니다.`, {
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
    key: 'che_종전제의',
    category: '외교',
    reqArg: true,
    args: { destNationId: 0 },
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
