import type { GeneralTriggerState, TriggerValue } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { beNeutral } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface UprisingArgs {}

const ACTION_NAME = '거병';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
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
            ...(general.meta as object),
            uprising: true as TriggerValue,
        };

        context.addLog(`${ACTION_NAME}을 준비했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        return { effects: [] };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_거병',
    category: '전략',
    reqArg: false,
    args: {},
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
