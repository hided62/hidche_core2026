import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type {
    Constraint,
    ConstraintContext,
} from '@sammo-ts/logic/constraints/types.js';
import { beNeutral, existsDestNation } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface AppointmentArgs {
    destNationId: number;
}

const ACTION_NAME = '임관';

const parseNationId = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw > 0 ? Math.floor(raw) : null;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements GeneralActionDefinition<TriggerState, AppointmentArgs> {
    public readonly key = 'che_임관';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): AppointmentArgs | null {
        const data = raw as { destNationId?: unknown };
        const destNationId = parseNationId(data?.destNationId);
        if (destNationId === null) {
            return null;
        }
        return { destNationId };
    }

    buildConstraints(_ctx: ConstraintContext, _args: AppointmentArgs): Constraint[] {
        return [beNeutral(), existsDestNation()];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: AppointmentArgs
    ): GeneralActionOutcome<TriggerState> {
        context.addLog(
            `${ACTION_NAME}을 신청했습니다. (국가 ${args.destNationId})`,
            {
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            }
        );
        return { effects: [] };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_임관',
    category: '전략',
    reqArg: true,
    args: { destNationId: 0 },
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
