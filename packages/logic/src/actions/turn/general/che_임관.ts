import type { GeneralTriggerState } from '../../../domain/entities.js';
import type {
    Constraint,
    ConstraintContext,
} from '../../../constraints/types.js';
import { beNeutral, existsDestNation } from '../../../constraints/presets.js';
import type { GeneralActionDefinition } from '../../definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '../../engine.js';
import { LogCategory, LogFormat } from '../../../logging/types.js';
import type { TurnCommandEnv } from '../commandEnv.js';
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

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_임관',
    category: '전략',
    reqArg: true,
    args: { destNationId: 0 },
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
