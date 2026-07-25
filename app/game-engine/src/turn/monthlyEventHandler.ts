import type { InMemoryTurnWorld, TurnCalendarContext, TurnCalendarHandler } from './inMemoryWorld.js';
import type { TurnEvent } from './types.js';

export interface MonthlyEventEnvironment {
    year: number;
    month: number;
    startyear: number;
    currentEventID: number;
    turnTime: Date;
}

export type MonthlyEventActionHandler = (
    args: readonly unknown[],
    environment: MonthlyEventEnvironment,
    event: TurnEvent
) => void;

export type MonthlyEventActionRegistry = ReadonlyMap<string, MonthlyEventActionHandler>;

const COMPARATORS = new Set(['==', '!=', '<', '>', '<=', '>=']);

const compare = (left: readonly (number | null)[], operator: string, right: readonly (number | null)[]): boolean => {
    const normalize = (values: readonly (number | null)[]): string =>
        values.map((value) => (value === null ? '' : String(value).padStart(12, '0'))).join(':');
    const lhs = normalize(left);
    const rhs = normalize(right);
    switch (operator) {
        case '==':
            return lhs === rhs;
        case '!=':
            return lhs !== rhs;
        case '<':
            return lhs < rhs;
        case '>':
            return lhs > rhs;
        case '<=':
            return lhs <= rhs;
        case '>=':
            return lhs >= rhs;
        default:
            return false;
    }
};

const readNullableInteger = (value: unknown, label: string): number | null => {
    if (value === null) {
        return null;
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new Error(`${label} must be an integer or null.`);
    }
    return value;
};

const evaluateCondition = (
    raw: unknown,
    environment: MonthlyEventEnvironment,
    remainingNationCount: number
): boolean => {
    if (typeof raw === 'boolean') {
        return raw;
    }
    if (!Array.isArray(raw) || typeof raw[0] !== 'string') {
        throw new Error('Event condition must be a boolean or condition tuple.');
    }

    const name = raw[0];
    const normalized = name.toLowerCase();
    if (normalized === 'not') {
        if (raw.length !== 2) {
            throw new Error('not condition requires exactly one operand.');
        }
        return !evaluateCondition(raw[1], environment, remainingNationCount);
    }
    if (normalized === 'and') {
        return raw.slice(1).every((condition) => evaluateCondition(condition, environment, remainingNationCount));
    }
    if (normalized === 'or') {
        return raw.slice(1).some((condition) => evaluateCondition(condition, environment, remainingNationCount));
    }
    if (normalized === 'xor') {
        return raw
            .slice(1)
            .reduce(
                (value, condition) => value !== evaluateCondition(condition, environment, remainingNationCount),
                false
            );
    }

    if (name === 'Date' || name === 'DateRelative') {
        const operator = raw[1];
        if (typeof operator !== 'string' || !COMPARATORS.has(operator)) {
            throw new Error(`${name} condition has an invalid comparator.`);
        }
        const year = readNullableInteger(raw[2], `${name}.year`);
        const month = readNullableInteger(raw[3], `${name}.month`);
        if (year === null && month === null) {
            throw new Error(`${name} condition requires year or month.`);
        }
        const currentYear = name === 'DateRelative' ? environment.year - environment.startyear : environment.year;
        return compare([year === null ? null : currentYear, month === null ? null : environment.month], operator, [
            year,
            month,
        ]);
    }

    if (name === 'RemainNation') {
        const operator = raw[1];
        const count = raw[2];
        if (typeof operator !== 'string' || !COMPARATORS.has(operator) || typeof count !== 'number') {
            throw new Error('RemainNation condition is invalid.');
        }
        return compare([remainingNationCount], operator, [Math.floor(count)]);
    }

    throw new Error(`Unsupported event condition: ${name}`);
};

const parseActions = (raw: unknown): Array<{ name: string; args: readonly unknown[] }> => {
    if (!Array.isArray(raw)) {
        throw new Error('Event action list must be an array.');
    }
    return raw.map((action) => {
        if (!Array.isArray(action) || typeof action[0] !== 'string') {
            throw new Error('Event action must be a tuple beginning with its name.');
        }
        return { name: action[0], args: action.slice(1) };
    });
};

export const createMonthlyEventHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    startYear: number;
    actions?: MonthlyEventActionRegistry;
}): TurnCalendarHandler => {
    const dispatch = (targetCode: 'pre_month' | 'month', context: TurnCalendarContext): void => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const year = targetCode === 'pre_month' ? context.previousYear : context.currentYear;
        const month = targetCode === 'pre_month' ? context.previousMonth : context.currentMonth;
        const remainingNationCount = world.listNations().filter((nation) => nation.id > 0).length;

        for (const event of world.listEvents(targetCode)) {
            const environment: MonthlyEventEnvironment = {
                year,
                month,
                startyear: options.startYear,
                currentEventID: event.id,
                turnTime: context.turnTime,
            };
            if (!evaluateCondition(event.condition, environment, remainingNationCount)) {
                continue;
            }
            for (const action of parseActions(event.action)) {
                if (action.name === 'DeleteEvent') {
                    world.removeEvent(event.id);
                    continue;
                }
                const handler = options.actions?.get(action.name);
                if (!handler) {
                    throw new Error(`Unsupported monthly event action: ${action.name} (eventId=${event.id})`);
                }
                handler(action.args, environment, event);
            }
        }
    };

    return {
        beforeMonthChanged: (context) => dispatch('pre_month', context),
        onMonthChanged: (context) => dispatch('month', context),
    };
};
