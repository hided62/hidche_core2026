import type { GeneralTriggerState, TriggerValue } from '../../../domain/entities.js';
import type { Constraint, ConstraintContext } from '../../../constraints/types.js';
import { beNeutral } from '../../../constraints/presets.js';
import type { GeneralActionDefinition } from '../../definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '../../engine.js';
import { createGeneralPatchEffect, createLogEffect } from '../../engine.js';
import { LogCategory, LogFormat, LogScope } from '../../../logging/types.js';

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
        const meta = {
            ...general.meta,
            uprising: true as TriggerValue,
        };

        return {
            effects: [
                createGeneralPatchEffect<TriggerState>(
                    { meta } as Partial<typeof general>,
                    general.id
                ),
                createLogEffect(`${ACTION_NAME}을 준비했습니다.`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }),
            ],
        };
    }
}
