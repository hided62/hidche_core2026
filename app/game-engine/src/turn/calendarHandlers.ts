import type { TurnCalendarHandler } from './inMemoryWorld.js';

export const composeCalendarHandlers = (
    ...handlers: Array<TurnCalendarHandler | null | undefined>
): TurnCalendarHandler | undefined => {
    const resolved = handlers.filter(Boolean) as TurnCalendarHandler[];
    if (resolved.length === 0) {
        return undefined;
    }
    return {
        onMonthChanged: async (context) => {
            for (const handler of resolved) {
                await handler.onMonthChanged?.(context);
            }
        },
        onYearChanged: async (context) => {
            for (const handler of resolved) {
                await handler.onYearChanged?.(context);
            }
        },
    };
};
