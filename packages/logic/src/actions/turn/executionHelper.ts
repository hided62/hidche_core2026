import type {
    GeneralActionResolution,
    GeneralActionResolveInputContext,
    GeneralActionResolver,
    TurnScheduleContext,
} from '../engine.js';
import { resolveGeneralAction } from '../engine.js';
import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';

export interface CommandLoader<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    load(key: string): Promise<GeneralActionResolver<TriggerState> | null>;
}

import type { LogEntryDraft } from '@sammo-ts/logic/logging/types.js';

export const processGeneralActionWithFallback = async <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    initialResolver: GeneralActionResolver<TriggerState>,
    context: GeneralActionResolveInputContext<TriggerState>,
    scheduleContext: TurnScheduleContext,
    initialArgs: unknown,
    commandLoader: CommandLoader<TriggerState>
): Promise<GeneralActionResolution> => {
    let currentResolver = initialResolver;
    let currentArgs = initialArgs;
    let loopLimit = 5; // Prevent infinite loops
    const accumulatedLogs: LogEntryDraft[] = [];

    while (loopLimit > 0) {
        loopLimit--;

        const resolution = resolveGeneralAction(currentResolver, context, scheduleContext, currentArgs);

        if (resolution.alternative) {
            accumulatedLogs.push(...resolution.logs);
            const { commandKey, args } = resolution.alternative;
            const nextResolver = await commandLoader.load(commandKey);

            if (nextResolver) {
                currentResolver = nextResolver;
                currentArgs = args;
                continue;
            }
        }

        // Prepend accumulated logs to the final resolution
        if (accumulatedLogs.length > 0) {
            resolution.logs.unshift(...accumulatedLogs);
        }
        return resolution;
    }

    throw new Error('Command fallback loop limit exceeded');
};
