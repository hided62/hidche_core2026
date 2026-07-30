import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { GeneralActionPipeline } from '@sammo-ts/logic/actionModules/general.js';
import { createGeneralActionEvent } from '@sammo-ts/logic/actionModules/events.js';

export const consumeSuccessfulStrategyItem = <TriggerState extends GeneralTriggerState>(
    pipeline: GeneralActionPipeline<TriggerState>,
    context: GeneralActionResolveContext<TriggerState>
): readonly string[] =>
    pipeline.dispatch(
        context,
        createGeneralActionEvent<TriggerState, 'strategy.succeeded'>('strategy.succeeded', {
            consumedItems: [],
        })
    ).payload.consumedItems;
