import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

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
) => void | Promise<void>;

export type MonthlyEventActionRegistry = ReadonlyMap<string, MonthlyEventActionHandler>;

export const MONTHLY_EVENT_ACTION_CATALOG = [
    'ProcessIncome',
    'NoticeToHistoryLog',
    'NewYear',
    'ResetOfficerLock',
    'RandomizeCityTradeRate',
    'RaiseDisaster',
    'UpdateCitySupply',
    'UpdateNationLevel',
    'ProcessSemiAnnual',
    'ProcessWarIncome',
    'CreateAdminNPC',
    'CreateManyNPC',
    'RegNPC',
    'RegNeutralNPC',
    'RaiseNPCNation',
    'RaiseInvader',
    'AutoDeleteInvader',
    'InvaderEnding',
    'ChangeCity',
    'ProvideNPCTroopLeader',
    'OpenNationBetting',
    'FinishNationBetting',
    'BlockScoutAction',
    'UnblockScoutAction',
    'AssignGeneralSpeciality',
    'AddGlobalBetray',
    'LostUniqueItem',
    'MergeInheritPointRank',
    'DeleteEvent',
] as const;

export type MonthlyEventActionName = (typeof MONTHLY_EVENT_ACTION_CATALOG)[number];

const COMPARATORS = new Set(['==', '!=', '<', '>', '<=', '>=']);
const CITY_TRADE_PROBABILITY_BY_LEVEL: Readonly<Record<number, number>> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0.2,
    5: 0.4,
    6: 0.6,
    7: 0.8,
    8: 1,
};

const resolveHiddenSeed = (world: InMemoryTurnWorld): string | number => {
    const state = world.getState();
    const rawSeed = state.meta.hiddenSeed ?? state.meta.seed ?? state.id;
    return typeof rawSeed === 'string' || typeof rawSeed === 'number' ? rawSeed : String(rawSeed);
};

export const createRandomizeCityTradeRateHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): MonthlyEventActionHandler => {
    return (_args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const rng = new RandUtil(
            new LiteHashDRBG(
                simpleSerialize(resolveHiddenSeed(world), 'randomizeCityTradeRate', environment.year, environment.month)
            )
        );

        // Ref's `SELECT city, level FROM city` walks the primary city key.
        // Make RNG consumption independent from PostgreSQL snapshot/insertion order.
        for (const city of world.listCities().sort((left, right) => left.id - right.id)) {
            const probability = CITY_TRADE_PROBABILITY_BY_LEVEL[city.level];
            if (probability === undefined) {
                throw new Error(`Unsupported city level for RandomizeCityTradeRate: ${city.level} (cityId=${city.id})`);
            }
            const trade = probability > 0 && rng.nextBool(probability) ? rng.nextRangeInt(95, 105) : null;
            const { trade: _previousTrade, ...metaWithoutTrade } = city.meta;
            world.updateCity(city.id, {
                meta: trade === null ? metaWithoutTrade : { ...metaWithoutTrade, trade },
            });
        }
    };
};

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

export interface ScenarioEventCalendarHandler extends TurnCalendarHandler {
    dispatchTarget(targetCode: string, context: TurnCalendarContext): Promise<void>;
}

export const createMonthlyEventHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    startYear: number;
    actions?: MonthlyEventActionRegistry;
}): ScenarioEventCalendarHandler => {
    const dispatchTarget = async (targetCode: string, context: TurnCalendarContext): Promise<void> => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const year = targetCode === 'pre_month' ? context.previousYear : context.currentYear;
        const month = targetCode === 'pre_month' ? context.previousMonth : context.currentMonth;
        const remainingNationCount = world.listNations().filter((nation) => nation.id > 0).length;
        // Ref does not write game_env.turntime until every event and
        // postUpdateMonthly step has completed. Event actions therefore see
        // the previous monthly boundary even after turnDate() has advanced
        // year/month. Generated general turn times depend on this distinction.
        const legacyTurnTime =
            context.legacyTurnTime ??
            new Date(context.turnTime.getTime() - world.getState().tickSeconds * 1_000);

        for (const event of world.listEvents(targetCode)) {
            const environment: MonthlyEventEnvironment = {
                year,
                month,
                startyear: options.startYear,
                currentEventID: event.id,
                turnTime: legacyTurnTime,
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
                await handler(action.args, environment, event);
            }
        }
    };

    return {
        beforeMonthChanged: (context) => dispatchTarget('pre_month', context),
        onMonthChanged: (context) => dispatchTarget('month', context),
        dispatchTarget,
    };
};
