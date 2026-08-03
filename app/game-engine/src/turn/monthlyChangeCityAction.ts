import type { City, CitySeed } from '@sammo-ts/logic';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler } from './monthlyEventHandler.js';

type MutableCity = City | CitySeed;
type CityNumericKey =
    | 'population'
    | 'agriculture'
    | 'commerce'
    | 'security'
    | 'defence'
    | 'wall';
type CityMaximumKey =
    | 'populationMax'
    | 'agricultureMax'
    | 'commerceMax'
    | 'securityMax'
    | 'defenceMax'
    | 'wallMax';
type ChangeCityKey = CityNumericKey | CityMaximumKey | 'trust' | 'trade';

const KEY_MAP: Readonly<Record<string, ChangeCityKey>> = {
    pop: 'population',
    agri: 'agriculture',
    comm: 'commerce',
    secu: 'security',
    trust: 'trust',
    def: 'defence',
    wall: 'wall',
    trade: 'trade',
    pop_max: 'populationMax',
    agri_max: 'agricultureMax',
    comm_max: 'commerceMax',
    secu_max: 'securityMax',
    def_max: 'defenceMax',
    wall_max: 'wallMax',
};
const MAX_KEY_MAP: Readonly<Record<CityNumericKey, CityMaximumKey>> = {
    population: 'populationMax',
    agriculture: 'agricultureMax',
    commerce: 'commerceMax',
    security: 'securityMax',
    defence: 'defenceMax',
    wall: 'wallMax',
};
const PERCENT_PATTERN = /^(\d+(?:\.\d+)?)%$/;
const MATH_PATTERN = /^([+\-/*])(\d+(?:\.\d+)?)$/;

const legacyRound = (value: number): number =>
    value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);

const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.min(maximum, Math.max(minimum, value));

const readCityTrust = (city: MutableCity): number => {
    if ('trust' in city && typeof city.trust === 'number') {
        return city.trust;
    }
    const value = city.meta.trust;
    return typeof value === 'number' ? value : 0;
};

const applyOperator = (current: number, operator: string, operand: number): number => {
    switch (operator) {
        case '+':
            return current + operand;
        case '-':
            return current - operand;
        case '*':
            return current * operand;
        case '/':
            if (operand === 0) {
                throw new Error('ChangeCity cannot divide by zero.');
            }
            return current / operand;
        default:
            throw new Error(`Unsupported ChangeCity operator: ${operator}`);
    }
};

const resolveTargets = (cities: readonly MutableCity[], rawTarget: unknown): MutableCity[] => {
    if (!rawTarget) {
        return [...cities];
    }
    const targetType =
        typeof rawTarget === 'string'
            ? rawTarget
            : Array.isArray(rawTarget) && typeof rawTarget[0] === 'string'
              ? rawTarget[0]
              : null;
    const targetArgs = Array.isArray(rawTarget) ? rawTarget.slice(1) : [];
    if (targetType === 'all') {
        return [...cities];
    }
    if (targetType === 'free') {
        return cities.filter((city) => city.nationId === 0);
    }
    if (targetType === 'occupied') {
        return cities.filter((city) => city.nationId !== 0);
    }
    if (targetType === 'cities') {
        // ref는 is_numeric(array)를 검사하므로 이 경로의 인자는 항상 도시명
        // 목록으로 SQL에 전달된다.
        const names = new Set(targetArgs.map(String));
        return cities.filter((city) => names.has(city.name));
    }
    throw new Error('ChangeCity target type is invalid.');
};

const resolveChangedValue = (
    city: MutableCity,
    key: ChangeCityKey,
    rawValue: unknown
): number => {
    if (typeof rawValue !== 'number' && typeof rawValue !== 'string') {
        throw new Error('ChangeCity values must be numbers or strings.');
    }
    if (key === 'trade') {
        const value = Number(rawValue);
        if (!Number.isFinite(value)) {
            throw new Error('ChangeCity trade must be numeric.');
        }
        return clamp(value, 95, 105);
    }
    if (key === 'trust') {
        if (typeof rawValue === 'number') {
            if (!Number.isInteger(rawValue)) {
                if (rawValue < 0) {
                    throw new Error('ChangeCity cannot multiply trust by a negative number.');
                }
                return Math.min(100, readCityTrust(city) * rawValue);
            }
            return clamp(rawValue, 0, 100);
        }
        const percent = rawValue.match(PERCENT_PATTERN);
        if (percent) {
            return clamp(legacyRound(Number(percent[1])), 0, 100);
        }
        const math = rawValue.match(MATH_PATTERN);
        if (math) {
            return clamp(applyOperator(readCityTrust(city), math[1]!, Number(math[2])), 0, 100);
        }
        throw new Error('ChangeCity trust pattern is invalid.');
    }

    const current = city[key];
    if (typeof rawValue === 'number') {
        if (!Number.isInteger(rawValue)) {
            if (rawValue < 0) {
                throw new Error('ChangeCity cannot multiply a city value by a negative number.');
            }
            const maximumKey = MAX_KEY_MAP[key as CityNumericKey];
            if (!maximumKey) {
                throw new Error(`ChangeCity float operation is invalid for ${key}.`);
            }
            return Math.min(city[maximumKey], legacyRound(current * rawValue));
        }
        const maximumKey = MAX_KEY_MAP[key as CityNumericKey];
        if (!maximumKey) {
            throw new Error(`ChangeCity integer operation is invalid for ${key}.`);
        }
        return Math.min(city[maximumKey], Math.max(0, rawValue));
    }

    const percent = rawValue.match(PERCENT_PATTERN);
    if (percent) {
        const maximumKey = MAX_KEY_MAP[key as CityNumericKey];
        if (!maximumKey) {
            throw new Error(`ChangeCity percent operation is invalid for ${key}.`);
        }
        return legacyRound(city[maximumKey] * (legacyRound(Number(percent[1])) / 100));
    }
    const math = rawValue.match(MATH_PATTERN);
    if (!math) {
        throw new Error('ChangeCity value pattern is invalid.');
    }
    const result = legacyRound(applyOperator(current, math[1]!, Number(math[2])));
    if (key.endsWith('Max')) {
        return Math.max(0, result);
    }
    const maximumKey = MAX_KEY_MAP[key as CityNumericKey];
    if (!maximumKey) {
        throw new Error(`ChangeCity math operation is invalid for ${key}.`);
    }
    return Math.min(city[maximumKey], Math.max(0, result));
};

export const applyChangeCity = <T extends MutableCity>(
    cities: readonly T[],
    rawTarget: unknown,
    rawActions: unknown
): T[] => {
    if (!rawActions || typeof rawActions !== 'object' || Array.isArray(rawActions)) {
        throw new Error('ChangeCity actions must be an object.');
    }
    const targets = resolveTargets(cities, rawTarget);
    return targets.map((city) => {
        const next = { ...city, meta: { ...city.meta } } as T & MutableCity;
        for (const [rawKey, rawValue] of Object.entries(rawActions)) {
            const key = KEY_MAP[rawKey];
            if (!key) {
                throw new Error(`Unsupported ChangeCity key: ${rawKey}`);
            }
            const value = resolveChangedValue(next, key, rawValue);
            if (key === 'trust' || key === 'trade') {
                if (key in next) {
                    (next as CitySeed)[key] = value;
                } else {
                    next.meta[key] = value;
                }
            } else {
                next[key] = value;
            }
        }
        return next as T;
    });
};

export const createChangeCityHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): MonthlyEventActionHandler => {
    return (args) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        for (const city of applyChangeCity(world.listCities(), args[0], args[1])) {
            world.updateCity(city.id, city);
        }
    };
};

export const applyInitialChangeCityEvents = <T extends CitySeed>(
    cities: readonly T[],
    initialEvents: readonly unknown[]
): T[] => {
    let result = cities.map((city) => ({ ...city }));
    for (const rawEvent of initialEvents) {
        if (!Array.isArray(rawEvent) || rawEvent[0] !== true) {
            throw new Error('Only unconditional initial events are supported.');
        }
        for (const rawAction of rawEvent.slice(1)) {
            if (Array.isArray(rawAction) && rawAction[0] === 'NoticeToHistoryLog') {
                // Initial history logging is handled by the install history
                // boundary; it has no city-state effect here.
                continue;
            }
            if (!Array.isArray(rawAction) || rawAction[0] !== 'ChangeCity') {
                throw new Error('Only ChangeCity initial actions are supported.');
            }
            const changed = applyChangeCity(result, rawAction[1], rawAction[2]);
            const changedById = new Map(changed.map((city) => [city.id, city]));
            result = result.map((city) => changedById.get(city.id) ?? city);
        }
    }
    return result;
};
