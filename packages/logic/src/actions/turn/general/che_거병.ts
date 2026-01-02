import type { GeneralTriggerState, TriggerValue } from '../../../domain/entities.js';
import type { Constraint, ConstraintContext } from '../../../constraints/types.js';
import { beNeutral } from '../../../constraints/presets.js';
import type { GeneralActionDefinition } from '../../definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '../../engine.js';
import { LogCategory, LogFormat } from '../../../logging/types.js';
import type { TurnCommandEnv } from '../commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface UprisingArgs {}

const ACTION_NAME = '거병';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements GeneralActionDefinition<TriggerState, UprisingArgs> {
    public readonly key = 'che_거병';
    public readonly name = ACTION_NAME;

    parseArgs(_raw: unknown): UprisingArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: UprisingArgs): Constraint[] {
        return [beNeutral()];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: UprisingArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;

        // 직접 수정 (Immer Draft)
        general.meta = {
            ...general.meta as object,
            uprising: true as TriggerValue,
        };

        context.addLog(`${ACTION_NAME}을 준비했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        return { effects: [] };
    }
}

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_거병',
    category: '전략',
    reqArg: false,
    args: {},
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
