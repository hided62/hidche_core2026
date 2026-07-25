import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { GeneralActionPipeline } from '@sammo-ts/logic/triggers/general-action.js';

export const consumeSuccessfulStrategyItem = <TriggerState extends GeneralTriggerState>(
    pipeline: GeneralActionPipeline<TriggerState>,
    context: GeneralActionResolveContext<TriggerState>
): Record<string, unknown> | null =>
    pipeline.onArbitraryAction(context, 'GeneralCommand', null, {
        command: '계략',
        success: true,
    });
