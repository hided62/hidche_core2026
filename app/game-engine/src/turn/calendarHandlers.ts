import type { TurnCalendarHandler } from './inMemoryWorld.js';

export const composeCalendarHandlers = (
    ...handlers: Array<TurnCalendarHandler | null | undefined>
): TurnCalendarHandler | undefined => {
    const resolved = handlers.filter(Boolean) as TurnCalendarHandler[];
    if (resolved.length === 0) {
        return undefined;
    }
    return {
        beforeMonthChanged: (context) => {
            for (const handler of resolved) {
                handler.beforeMonthChanged?.(context);
            }
        },
        onMonthChanged: (context) => {
            for (const handler of resolved) {
                handler.onMonthChanged?.(context);
            }
        },
        onYearChanged: (context) => {
            for (const handler of resolved) {
                handler.onYearChanged?.(context);
            }
        },
    };
};
