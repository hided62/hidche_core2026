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

export interface FoundingArgs {}

const ACTION_NAME = '건국';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements GeneralActionDefinition<TriggerState, FoundingArgs> {
    public readonly key = 'che_건국';
    public readonly name = ACTION_NAME;

    parseArgs(_raw: unknown): FoundingArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: FoundingArgs): Constraint[] {
        return [beNeutral()];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: FoundingArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;

        // 직접 수정 (Immer Draft)
        general.meta = {
            ...general.meta as object,
            founding: true as TriggerValue,
        };

        context.addLog(`${ACTION_NAME}을 준비했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        return { effects: [] };
    }
}

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_건국',
    category: '전략',
    reqArg: false,
    args: {},
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
