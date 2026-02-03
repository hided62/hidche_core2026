import { asRecord, parseJson, type RandUtil } from '@sammo-ts/common';
import type { GeneralItemSlots } from '../domain/entities.js';
import type { ItemModule } from '../items/types.js';

export type UniqueItemPool = Record<string, Record<string, number>>;

export type UniqueLotteryConfig = {
    allItems: UniqueItemPool;
    maxUniqueItemLimit: Array<[number, number]>;
    uniqueTrialCoef: number;
    maxUniqueTrialProb: number;
    minMonthToAllowInheritItem: number;
};

export type UniqueLotteryInput = {
    rng: RandUtil;
    config: UniqueLotteryConfig;
    itemRegistry: Map<string, ItemModule>;
    generalItems: GeneralItemSlots;
    occupiedUniqueCounts: Map<string, number>;
    scenarioId: number;
    userCount: number;
    currentYear: number;
    currentMonth: number;
    startYear: number;
    initYear: number;
    initMonth: number;
    acquireType?: string;
    inheritRandomUnique?: boolean;
};

const DEFAULT_MAX_UNIQUE_ITEM_LIMIT: Array<[number, number]> = [
    [-1, 1],
    [3, 2],
    [10, 3],
    [20, 4],
];

const DEFAULT_UNIQUE_TRIAL_COEF = 1;
const DEFAULT_MAX_UNIQUE_TRIAL_PROB = 0.25;
const DEFAULT_MIN_MONTH_TO_ALLOW_INHERIT_ITEM = 4;

const readNumber = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const normalizeItemPool = (value: unknown): UniqueItemPool => {
    if (typeof value === 'string') {
        const parsed = parseJson<UniqueItemPool>(value);
        return normalizeItemPool(parsed);
    }
    const record = asRecord(value);
    const result: UniqueItemPool = {};
    for (const [itemType, rawItems] of Object.entries(record)) {
        const rawEntries = asRecord(rawItems);
        const entries: Record<string, number> = {};
        for (const [itemKey, rawCount] of Object.entries(rawEntries)) {
            const count = readNumber(rawCount, Number.NaN);
            if (!Number.isFinite(count)) {
                continue;
            }
            entries[itemKey] = Math.floor(count);
        }
        result[itemType] = entries;
    }
    return result;
};

const normalizeLimitTable = (value: unknown): Array<[number, number]> => {
    if (!Array.isArray(value)) {
        return [...DEFAULT_MAX_UNIQUE_ITEM_LIMIT];
    }
    const result: Array<[number, number]> = [];
    for (const entry of value) {
        if (!Array.isArray(entry) || entry.length < 2) {
            continue;
        }
        const year = readNumber(entry[0], Number.NaN);
        const limit = readNumber(entry[1], Number.NaN);
        if (!Number.isFinite(year) || !Number.isFinite(limit)) {
            continue;
        }
        result.push([Math.floor(year), Math.floor(limit)]);
    }
    return result.length > 0 ? result : [...DEFAULT_MAX_UNIQUE_ITEM_LIMIT];
};

export const resolveUniqueConfig = (configConst: Record<string, unknown>): UniqueLotteryConfig => {
    const allItems = normalizeItemPool(configConst.allItems);
    return {
        allItems,
        maxUniqueItemLimit: normalizeLimitTable(configConst.maxUniqueItemLimit),
        uniqueTrialCoef: readNumber(configConst.uniqueTrialCoef, DEFAULT_UNIQUE_TRIAL_COEF),
        maxUniqueTrialProb: readNumber(configConst.maxUniqueTrialProb, DEFAULT_MAX_UNIQUE_TRIAL_PROB),
        minMonthToAllowInheritItem: Math.max(
            0,
            Math.floor(readNumber(configConst.minMonthToAllowInheritItem, DEFAULT_MIN_MONTH_TO_ALLOW_INHERIT_ITEM))
        ),
    };
};

export const countOccupiedUniqueItems = (
    generals: GeneralItemSlots[],
    itemRegistry: Map<string, ItemModule>
): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const items of generals) {
        const values = [items.horse, items.weapon, items.book, items.item];
        for (const itemKey of values) {
            if (!itemKey) {
                continue;
            }
            const module = itemRegistry.get(itemKey);
            if (!module || module.buyable) {
                continue;
            }
            counts.set(itemKey, (counts.get(itemKey) ?? 0) + 1);
        }
    }
    return counts;
};

const joinYearMonth = (year: number, month: number): number => year * 12 + month - 1;

const serializeSeed = (...values: Array<string | number>): string =>
    values
        .map((value) => (typeof value === 'string' ? `str(${value.length},${value})` : `int(${Math.floor(value)})`))
        .join('|');

export const buildVoteUniqueSeed = (hiddenSeed: string | number, voteId: number, generalId: number): string =>
    serializeSeed(hiddenSeed, 'voteUnique', voteId, generalId);

export const rollUniqueLottery = (input: UniqueLotteryInput): string | null => {
    const {
        rng,
        config,
        itemRegistry,
        generalItems,
        occupiedUniqueCounts,
        scenarioId,
        userCount,
        currentYear,
        currentMonth,
        startYear,
        initYear,
        initMonth,
        acquireType,
        inheritRandomUnique,
    } = input;

    if (userCount <= 0) {
        return null;
    }

    const itemTypes = Object.keys(config.allItems);
    const itemTypeCnt = itemTypes.length;
    if (itemTypeCnt <= 0) {
        return null;
    }

    const relYear = currentYear - startYear;
    let maxTrialCountByYear = 1;
    for (const [targetYear, targetTrialCnt] of config.maxUniqueItemLimit) {
        if (relYear < targetYear) {
            break;
        }
        maxTrialCountByYear = targetTrialCnt;
    }

    let trialCnt = Math.min(itemTypeCnt, maxTrialCountByYear);
    let maxCnt = itemTypeCnt;

    const invalidItemTypes = new Set<string>();
    const equippedItems: Array<[string, string | null]> = [
        ['horse', generalItems.horse],
        ['weapon', generalItems.weapon],
        ['book', generalItems.book],
        ['item', generalItems.item],
    ];

    for (const [slot, itemKey] of equippedItems) {
        if (!itemKey) {
            continue;
        }
        const module = itemRegistry.get(itemKey);
        if (!module || module.buyable) {
            continue;
        }
        invalidItemTypes.add(slot);
        trialCnt -= 1;
        maxCnt -= 1;
    }

    if (trialCnt <= 0 || maxCnt <= 0) {
        return null;
    }

    const relMonthByInit =
        joinYearMonth(currentYear, currentMonth) - joinYearMonth(initYear, initMonth);
    const availableBuyUnique = relMonthByInit >= config.minMonthToAllowInheritItem;

    let prob: number;
    if (scenarioId < 100) {
        prob = 1 / (userCount * 3 * itemTypeCnt);
    } else {
        prob = 1 / (userCount * itemTypeCnt);
    }

    if (acquireType === '설문조사') {
        prob = 1 / (userCount * itemTypeCnt * 0.7 / 3);
    } else if (acquireType === '랜덤 임관') {
        prob = 1 / (userCount * itemTypeCnt / 10 / 2);
    }

    prob *= config.uniqueTrialCoef;
    if (prob > config.maxUniqueTrialProb) {
        prob = config.maxUniqueTrialProb;
    }

    prob /= Math.sqrt(7);
    const moreProb = Math.pow(10, 1 / 4);

    if (inheritRandomUnique && availableBuyUnique) {
        prob = 1;
    } else if (acquireType === '건국') {
        prob = 1;
    }

    let success = false;
    for (let i = 0; i < maxCnt; i += 1) {
        if (rng.nextBool(prob)) {
            success = true;
            break;
        }
        prob *= moreProb;
    }

    if (!success) {
        return null;
    }

    const availableUnique: Array<[string, number]> = [];
    for (const itemType of itemTypes) {
        if (invalidItemTypes.has(itemType)) {
            continue;
        }
        const itemEntries = config.allItems[itemType] ?? {};
        for (const [itemKey, rawCount] of Object.entries(itemEntries)) {
            const count = readNumber(rawCount, 0);
            if (count <= 0) {
                continue;
            }
            const module = itemRegistry.get(itemKey);
            if (!module || module.buyable) {
                continue;
            }
            const remain = count - (occupiedUniqueCounts.get(itemKey) ?? 0);
            if (remain > 0) {
                availableUnique.push([itemKey, remain]);
            }
        }
    }

    if (availableUnique.length === 0) {
        return null;
    }

    return rng.choiceUsingWeightPair(availableUnique);
};
