import { asRecord, JosaUtil, parseJson, type RandUtil } from '@sammo-ts/common';
import type { General, GeneralItemSlots, GeneralTriggerState } from '../domain/entities.js';
import type { GeneralActionResolveContext } from '../actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '../logging/types.js';
import type { ItemModule } from '../items/types.js';
import { equipNewItem } from '../items/inventory.js';

export type UniqueItemPool = Record<string, Record<string, number>>;

export type UniqueAcquireType = '아이템' | '설문조사' | '랜덤 임관' | '건국';

export type UniqueLotteryRequest = {
    acquireType: UniqueAcquireType;
    reason: string;
    nationName?: string;
};

export type UniqueLotteryRunner = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    request: UniqueLotteryRequest & { general: General<TriggerState> }
) => ItemModule | null;

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
    acquireType?: UniqueAcquireType;
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

export const addOccupiedUniqueItemKeys = (
    counts: Map<string, number>,
    itemKeys: Iterable<string | null | undefined>,
    itemRegistry: Map<string, ItemModule>
): Map<string, number> => {
    for (const itemKey of itemKeys) {
        if (!itemKey) {
            continue;
        }
        const module = itemRegistry.get(itemKey);
        if (!module || module.buyable) {
            continue;
        }
        counts.set(itemKey, (counts.get(itemKey) ?? 0) + 1);
    }
    return counts;
};

const joinYearMonth = (year: number, month: number): number => year * 12 + month - 1;

const serializeSeed = (...values: Array<string | number>): string =>
    values
        .map((value) => (typeof value === 'string' ? `str(${value.length},${value})` : `int(${Math.floor(value)})`))
        .join('|');

export const buildGenericUniqueSeed = (
    hiddenSeed: string | number,
    year: number,
    month: number,
    generalId: number,
    reason?: string
): string =>
    reason !== undefined
        ? serializeSeed(hiddenSeed, 'unique', year, month, generalId, reason)
        : serializeSeed(hiddenSeed, 'unique', year, month, generalId);

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
    const resolvedAcquireType = acquireType ?? '아이템';

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

    const relMonthByInit = joinYearMonth(currentYear, currentMonth) - joinYearMonth(initYear, initMonth);
    const availableBuyUnique = relMonthByInit >= config.minMonthToAllowInheritItem;

    let prob: number;
    if (scenarioId < 100) {
        prob = 1 / (userCount * 3 * itemTypeCnt);
    } else {
        prob = 1 / (userCount * itemTypeCnt);
    }

    if (resolvedAcquireType === '설문조사') {
        prob = 1 / ((userCount * itemTypeCnt * 0.7) / 3);
    } else if (resolvedAcquireType === '랜덤 임관') {
        prob = 1 / ((userCount * itemTypeCnt) / 10 / 2);
    }

    prob *= config.uniqueTrialCoef;
    if (prob > config.maxUniqueTrialProb) {
        prob = config.maxUniqueTrialProb;
    }

    prob /= Math.sqrt(7);
    const moreProb = Math.pow(10, 1 / 4);

    if (inheritRandomUnique && availableBuyUnique) {
        prob = 1;
    } else if (resolvedAcquireType === '건국') {
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

const applyUniqueItemGain = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    context: GeneralActionResolveContext<TriggerState>,
    itemModule: ItemModule,
    acquireType: UniqueAcquireType,
    nationNameOverride?: string
): void => {
    const general = context.general;
    const nationName = nationNameOverride ?? context.nation?.name ?? '재야';
    const generalName = general.name;
    const itemName = itemModule.name;
    const itemRawName = itemModule.rawName;
    const josaYi = JosaUtil.pick(generalName, '이');
    const josaUl = JosaUtil.pick(itemRawName, '을');
    const addLog = context.addPostProgressionLog ?? context.addLog;

    equipNewItem(general, itemModule.slot, itemModule.key, {
        ...(itemModule.initialCharges === undefined ? {} : { charges: itemModule.initialCharges }),
    });

    addLog(`<C>${itemName}</>${josaUl} 습득했습니다!`, {
        scope: LogScope.GENERAL,
        category: LogCategory.ACTION,
        format: LogFormat.MONTH,
    });
    addLog(`<C>${itemName}</>${josaUl} 습득`, {
        scope: LogScope.GENERAL,
        category: LogCategory.HISTORY,
        format: LogFormat.YEAR_MONTH,
    });
    addLog(`<Y>${generalName}</>${josaYi} <C>${itemName}</>${josaUl} 습득했습니다!`, {
        scope: LogScope.SYSTEM,
        category: LogCategory.SUMMARY,
        format: LogFormat.MONTH,
    });
    addLog(
        `<C><b>【${acquireType}】</b></><D><b>${nationName}</b></>의 <Y>${generalName}</>${josaYi} <C>${itemName}</>${josaUl} 습득했습니다!`,
        {
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        }
    );
};

export const tryApplyUniqueLottery = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    context: GeneralActionResolveContext<TriggerState> & { uniqueLottery?: UniqueLotteryRunner },
    request: UniqueLotteryRequest
): boolean => {
    const runner = context.uniqueLottery;
    if (!runner) {
        return false;
    }
    const itemModule = runner({ ...request, general: context.general });
    if (!itemModule) {
        return false;
    }
    applyUniqueItemGain(context, itemModule, request.acquireType, request.nationName ?? context.legacyStaticNationName);
    return true;
};
