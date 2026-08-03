import { JosaUtil, LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import {
    LogCategory,
    LogFormat,
    LogScope,
    countOccupiedUniqueItems,
    createItemModuleRegistry,
    equipNewItem,
    resolveUniqueConfig,
    type ItemModule,
} from '@sammo-ts/logic';
import { buildLegacyDefaultUniqueItemPool } from '@sammo-ts/logic/rewards/legacyUniqueItemPool.js';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler } from './monthlyEventHandler.js';
import type { InMemoryReservedTurnStore } from './reservedTurnStore.js';
import type { TurnGeneral } from './types.js';

const NATION_LEVEL_CITY_COUNTS = [0, 1, 2, 5, 8, 11, 16, 21] as const;
const NATION_LEVEL_NAMES = ['방랑군', '호족', '군벌', '주자사', '주목', '공', '왕', '황제'] as const;
// Legacy Util::range(minChiefLevel, 12) is Python-style and excludes 12.
const EXCLUSIVE_MAX_CHIEF_LEVEL = 12;

const resolveNationChiefLevel = (nationLevel: number): number => {
    if (nationLevel >= 6) return 5;
    if (nationLevel >= 4) return 7;
    if (nationLevel >= 2) return 9;
    return 11;
};

const readNumber = (value: unknown, fallback = 0): number => {
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

const resolveHiddenSeed = (world: InMemoryTurnWorld): string | number => {
    const state = world.getState();
    const rawSeed = state.meta.hiddenSeed ?? state.meta.seed ?? state.id;
    return typeof rawSeed === 'string' || typeof rawSeed === 'number' ? rawSeed : String(rawSeed);
};

const countNonBuyableItems = (general: TurnGeneral, itemRegistry: Map<string, ItemModule>): number =>
    Object.values(general.role.items).filter((itemKey) => {
        if (!itemKey) return false;
        return itemRegistry.get(itemKey)?.buyable === false;
    }).length;

const addCount = (target: Map<string, number>, source: ReadonlyMap<string, number>): void => {
    for (const [key, value] of source) {
        target.set(key, (target.get(key) ?? 0) + value);
    }
};

const giveRandomUniqueItem = (options: {
    world: InMemoryTurnWorld;
    general: TurnGeneral;
    nationName: string;
    rng: RandUtil;
    itemRegistry: Map<string, ItemModule>;
    allItems: Record<string, Record<string, number>>;
    additionalOccupiedCounts: ReadonlyMap<string, number>;
    year: number;
    month: number;
}): boolean => {
    const invalidSlots = new Set<string>();
    for (const [slot, itemKey] of Object.entries(options.general.role.items)) {
        if (itemKey && options.itemRegistry.get(itemKey)?.buyable === false) {
            invalidSlots.add(slot);
        }
    }

    const occupiedCounts = countOccupiedUniqueItems(
        options.world.listGenerals().map((general) => general.role.items),
        options.itemRegistry
    );
    addCount(occupiedCounts, options.additionalOccupiedCounts);

    const available: Array<[ItemModule, number]> = [];
    for (const [slot, itemEntries] of Object.entries(options.allItems)) {
        if (invalidSlots.has(slot)) {
            continue;
        }
        for (const [itemKey, count] of Object.entries(itemEntries)) {
            const item = options.itemRegistry.get(itemKey);
            if (!item || item.buyable || count <= 0) {
                continue;
            }
            const remain = count - (occupiedCounts.get(itemKey) ?? 0);
            if (remain > 0) {
                available.push([item, remain]);
            }
        }
    }
    if (available.length === 0) {
        return false;
    }

    const item = options.rng.choiceUsingWeightPair(available);
    const nextGeneral = options.world.getGeneralById(options.general.id);
    if (!nextGeneral) {
        return false;
    }
    equipNewItem(nextGeneral, item.slot, item.key, {
        ...(item.initialCharges === undefined ? {} : { charges: item.initialCharges }),
    });
    options.world.updateGeneral(nextGeneral.id, {
        role: nextGeneral.role,
        itemInventory: nextGeneral.itemInventory,
    });

    const josaYi = JosaUtil.pick(nextGeneral.name, '이');
    const josaUl = JosaUtil.pick(item.rawName, '을');
    options.world.pushLog({
        scope: LogScope.GENERAL,
        category: LogCategory.ACTION,
        generalId: nextGeneral.id,
        text: `<C>${item.name}</>${josaUl} 습득했습니다!`,
        format: LogFormat.MONTH,
        year: options.year,
        month: options.month,
    });
    options.world.pushLog({
        scope: LogScope.GENERAL,
        category: LogCategory.HISTORY,
        generalId: nextGeneral.id,
        text: `<C>${item.name}</>${josaUl} 습득`,
        format: LogFormat.YEAR_MONTH,
        year: options.year,
        month: options.month,
    });
    options.world.pushLog({
        scope: LogScope.SYSTEM,
        category: LogCategory.SUMMARY,
        text: `<Y>${nextGeneral.name}</>${josaYi} <C>${item.name}</>${josaUl} 습득했습니다!`,
        format: LogFormat.MONTH,
        year: options.year,
        month: options.month,
    });
    options.world.pushLog({
        scope: LogScope.SYSTEM,
        category: LogCategory.HISTORY,
        text: `<C><b>【작위보상】</b></><D><b>${options.nationName}</b></>의 <Y>${nextGeneral.name}</>${josaYi} <C>${item.name}</>${josaUl} 습득했습니다!`,
        format: LogFormat.YEAR_MONTH,
        year: options.year,
        month: options.month,
    });
    return true;
};

const pushLevelLogs = (options: {
    world: InMemoryTurnWorld;
    nationId: number;
    nationName: string;
    lordName: string;
    oldLevel: number;
    newLevel: number;
    year: number;
    month: number;
}): void => {
    const oldLevelName = NATION_LEVEL_NAMES[options.oldLevel];
    const levelName = NATION_LEVEL_NAMES[options.newLevel];
    if (oldLevelName === undefined || levelName === undefined) {
        throw new Error(`Unsupported nation level transition: ${options.oldLevel} -> ${options.newLevel}`);
    }
    const josaYi = JosaUtil.pick(options.lordName, '이');
    const josaRo = JosaUtil.pick(levelName, '로');
    let globalText: string | null = null;
    let nationText: string | null = null;

    if (options.newLevel === 7) {
        globalText = `<Y><b>【작위】</b></><D><b>${options.nationName}</b></> ${oldLevelName} <Y>${options.lordName}</>${josaYi} <C>${levelName}</>${josaRo} 옹립되었습니다.`;
        nationText = `<D><b>${options.nationName}</b></> ${oldLevelName} <Y>${options.lordName}</>${josaYi} <C>${levelName}</>${josaRo} 옹립`;
    } else if (options.newLevel === 6) {
        globalText = `<Y><b>【작위】</b></><D><b>${options.nationName}</b></>의 <Y>${options.lordName}</>${josaYi} <C>${levelName}</>${josaRo} 책봉되었습니다.`;
        nationText = `<D><b>${options.nationName}</b></>의 <Y>${options.lordName}</>${josaYi} <C>${levelName}</>${josaRo} 책봉`;
    } else if (options.newLevel >= 3) {
        globalText = `<Y><b>【작위】</b></><D><b>${options.nationName}</b></>의 <Y>${options.lordName}</>${josaYi} <C>${levelName}</>${josaRo} 임명되었습니다.`;
        nationText = `<D><b>${options.nationName}</b></>의 <Y>${options.lordName}</>${josaYi} <C>${levelName}</>${josaRo} 임명됨`;
    } else if (options.newLevel === 2) {
        const josaRa = JosaUtil.pick(options.nationName, '라');
        globalText = `<Y><b>【작위】</b></><Y>${options.lordName}</>${josaYi} 독립하여 <D><b>${options.nationName}</b></>${josaRa}는 <C>${levelName}</>${josaRo} 나섰습니다.`;
        nationText = `<Y>${options.lordName}</>${josaYi} 독립하여 <D><b>${options.nationName}</b></>${josaRa}는 <C>${levelName}</>${josaRo} 나서다`;
    }
    if (globalText) {
        options.world.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            text: globalText,
            format: LogFormat.YEAR_MONTH,
            year: options.year,
            month: options.month,
        });
    }
    if (nationText) {
        options.world.pushLog({
            scope: LogScope.NATION,
            category: LogCategory.HISTORY,
            nationId: options.nationId,
            text: nationText,
            format: LogFormat.YEAR_MONTH,
            year: options.year,
            month: options.month,
        });
    }
};

export const createUpdateNationLevelHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    reservedTurns: InMemoryReservedTurnStore;
    itemModules: ItemModule[];
    loadAdditionalOccupiedUniqueCounts?: () => Promise<Map<string, number>>;
}): MonthlyEventActionHandler => {
    const itemRegistry = createItemModuleRegistry(options.itemModules);

    return async (_args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const uniqueConfig = resolveUniqueConfig(world.getScenarioConfig().const);
        if (Object.keys(uniqueConfig.allItems).length === 0) {
            uniqueConfig.allItems = buildLegacyDefaultUniqueItemPool(itemRegistry);
        }
        const additionalOccupiedCounts = options.loadAdditionalOccupiedUniqueCounts
            ? await options.loadAdditionalOccupiedUniqueCounts()
            : new Map<string, number>();
        const cityCounts = new Map<number, number>();
        for (const city of world.listCities()) {
            if (city.level >= 4) {
                cityCounts.set(city.nationId, (cityCounts.get(city.nationId) ?? 0) + 1);
            }
        }
        const state = world.getState();
        const worldKillturn = readNumber(state.meta.killturn);
        const turnMinutes = state.tickSeconds / 60;
        if (!(turnMinutes > 0)) {
            throw new Error('UpdateNationLevel requires a positive turn term.');
        }
        const targetKillturn = worldKillturn - (24 * 60) / turnMinutes;
        const hiddenSeed = resolveHiddenSeed(world);

        for (const nation of world.listNations().sort((left, right) => left.id - right.id)) {
            // Legacy persists only founded nations in `nation`; Core also keeps
            // an id=0 sentinel so neutral cities can retain a Nation reference.
            // The sentinel must never participate in title promotion.
            if (nation.id <= 0) {
                continue;
            }
            const cityCount = cityCounts.get(nation.id) ?? 0;
            let newLevel = 0;
            for (let level = 0; level < NATION_LEVEL_CITY_COUNTS.length; level += 1) {
                if (cityCount < NATION_LEVEL_CITY_COUNTS[level]!) {
                    break;
                }
                newLevel = level;
            }
            if (newLevel <= nation.level) {
                continue;
            }

            const oldLevel = nation.level;
            const levelDiff = newLevel - oldLevel;
            const lord = world
                .listGenerals()
                .sort((left, right) => left.id - right.id)
                .find((general) => general.nationId === nation.id && general.officerLevel === 12);
            const nextMeta = newLevel === 7 ? { ...nation.meta, can_국기변경: 1, can_국호변경: 1 } : { ...nation.meta };
            world.updateNation(nation.id, {
                level: newLevel,
                gold: nation.gold + newLevel * 1000,
                rice: nation.rice + newLevel * 1000,
                meta: nextMeta,
            });
            pushLevelLogs({
                world,
                nationId: nation.id,
                nationName: nation.name,
                lordName: lord?.name ?? '',
                oldLevel,
                newLevel,
                year: environment.year,
                month: environment.month,
            });

            for (
                let officerLevel = resolveNationChiefLevel(newLevel);
                officerLevel < EXCLUSIVE_MAX_CHIEF_LEVEL;
                officerLevel += 1
            ) {
                options.reservedTurns.ensureNationTurns(nation.id, officerLevel);
            }

            const eligible = world
                .listGenerals()
                .filter(
                    (general) =>
                        general.nationId === nation.id &&
                        general.npcState < 2 &&
                        readNumber(general.meta.killturn, Number.NEGATIVE_INFINITY) >= targetKillturn
                )
                .sort((left, right) => left.id - right.id);
            const chief = eligible.find((general) => general.officerLevel === 12);
            const relativeYear = environment.year - environment.startyear;
            let maxTrialCountByYear = 1;
            for (const [targetYear, targetTrialCount] of uniqueConfig.maxUniqueItemLimit) {
                if (relativeYear < targetYear) {
                    break;
                }
                maxTrialCountByYear = targetTrialCount;
            }
            const itemTypeCount = Object.keys(uniqueConfig.allItems).length;
            const candidates: Array<[TurnGeneral, number]> = [];
            for (const general of eligible) {
                const trialCount =
                    Math.min(maxTrialCountByYear, itemTypeCount) - countNonBuyableItems(general, itemRegistry);
                if (trialCount <= 0) {
                    continue;
                }
                let score = readNumber(general.meta.belong) + 10;
                if (general.officerLevel === 12) score += 60;
                else if (general.officerLevel === 11) score += 30;
                else if (general.officerLevel > 4) score += 15;
                score *= 2 ** trialCount;
                candidates.push([general, score]);
            }
            const nationRng = new RandUtil(
                new LiteHashDRBG(
                    simpleSerialize(hiddenSeed, 'nationLevelUp', environment.year, environment.month, nation.id)
                )
            );
            for (let index = 0; index < levelDiff && candidates.length > 0; index += 1) {
                const winner = nationRng.choiceUsingWeightPair(candidates);
                const winnerIndex = candidates.findIndex(([general]) => general.id === winner.id);
                if (winnerIndex >= 0) {
                    candidates.splice(winnerIndex, 1);
                }
                const itemRng = new RandUtil(
                    new LiteHashDRBG(
                        simpleSerialize(
                            hiddenSeed,
                            'givenUnique',
                            environment.year,
                            environment.month,
                            nation.id,
                            winner.id
                        )
                    )
                );
                giveRandomUniqueItem({
                    world,
                    general: winner,
                    nationName: nation.name,
                    rng: itemRng,
                    itemRegistry,
                    allItems: uniqueConfig.allItems,
                    additionalOccupiedCounts,
                    year: environment.year,
                    month: environment.month,
                });
            }
            const isUnited = readNumber(state.meta.isunited ?? state.meta.isUnited);
            if (chief?.userId && isUnited === 0) {
                world.queueInheritancePointAdjustment(chief.userId, 'unifier', 250 * levelDiff);
            }
        }
    };
};
