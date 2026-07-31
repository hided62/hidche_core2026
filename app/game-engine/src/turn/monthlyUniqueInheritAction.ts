import { JosaUtil, LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import {
    LogCategory,
    LogFormat,
    LogScope,
    cloneItemInventory,
    createItemModuleRegistry,
    ensureItemInventory,
    removeEquippedItem,
    type ItemModule,
    type ItemSlot,
} from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import { ALL_MERGED_INHERITANCE_KEYS, computeActiveInheritancePoint } from './inheritancePointCalculation.js';
import type { MonthlyEventActionHandler } from './monthlyEventHandler.js';
import type { TurnGeneral } from './types.js';

const LEGACY_ITEM_SLOTS: readonly ItemSlot[] = ['horse', 'weapon', 'book', 'item'];

const readNumber = (source: Record<string, unknown>, key: string): number => {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return 0;
};

const resolveHiddenSeed = (world: InMemoryTurnWorld): string | number => {
    const state = world.getState();
    const value = state.meta.hiddenSeed ?? state.meta.seed ?? state.id;
    return typeof value === 'string' || typeof value === 'number' ? value : String(value);
};

const readLostProbability = (value: unknown): number => {
    if (value === undefined) {
        return 0.1;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('LostUniqueItem probability must be a finite number.');
    }
    return value;
};

export const createLostUniqueItemHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    itemModules: ItemModule[];
}): MonthlyEventActionHandler => {
    const itemRegistry = createItemModuleRegistry(options.itemModules);
    return (args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const probability = readLostProbability(args[0]);
        const rng = new RandUtil(
            new LiteHashDRBG(
                simpleSerialize(resolveHiddenSeed(world), 'LostUniqueItem', environment.year, environment.month)
            )
        );
        let totalLostCount = 0;
        let maximumLostCount = 0;
        let maximumLostGeneralNames: string[] = [];

        // ref SELECT와 createObjListFromDB 모두 ORDER BY가 없으므로 loader 순서를
        // 유지한다. 아이템 객체 생성 순서는 horse, weapon, book, item이다.
        for (const general of world.listGenerals().filter((entry) => entry.npcState <= 1)) {
            const nextGeneral: TurnGeneral = {
                ...general,
                role: { ...general.role, items: { ...general.role.items } },
                itemInventory: cloneItemInventory(ensureItemInventory(general)),
            };
            let lostCount = 0;
            for (const slot of LEGACY_ITEM_SLOTS) {
                const itemKey = nextGeneral.role.items[slot];
                if (!itemKey) {
                    continue;
                }
                const item = itemRegistry.get(itemKey);
                if (!item) {
                    throw new Error(`Unknown equipped item: ${itemKey} (generalId=${general.id}).`);
                }
                if (item.buyable || !rng.nextBool(probability)) {
                    continue;
                }
                removeEquippedItem(nextGeneral, slot);
                lostCount += 1;
                totalLostCount += 1;
                const josaUl = JosaUtil.pick(item.rawName, '을');
                world.pushLog({
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: general.id,
                    text: `<C>${item.name}</>${josaUl} 잃었습니다.`,
                    format: LogFormat.PLAIN,
                    year: environment.year,
                    month: environment.month,
                });
            }
            if (lostCount === 0) {
                continue;
            }
            world.updateGeneral(general.id, {
                role: nextGeneral.role,
                itemInventory: nextGeneral.itemInventory,
            });
            if (lostCount > maximumLostCount) {
                maximumLostCount = lostCount;
                maximumLostGeneralNames = [general.name];
            } else if (lostCount === maximumLostCount) {
                maximumLostGeneralNames.push(general.name);
            }
        }

        if (totalLostCount === 0) {
            world.pushLog({
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: '<R><b>【망실】</b></>어떤 아이템도 잃지 않았습니다!',
                format: LogFormat.YEAR_MONTH,
                year: environment.year,
                month: environment.month,
            });
            return;
        }
        const totalMaximumGenerals = maximumLostGeneralNames.length;
        const displayedNames = maximumLostGeneralNames.slice(0, 4);
        let nameList = displayedNames.join(', ');
        if (totalMaximumGenerals > 4) {
            nameList += ` 외 ${totalMaximumGenerals - 4}명`;
        }
        const josaYi = JosaUtil.pick(nameList, '이');
        world.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            text: `<R><b>【망실】</b></>불운하게도 <Y>${nameList}</>${josaYi} 한 번에 유니크 <C>${maximumLostCount}</>종을 잃었습니다! (총 <C>${totalLostCount}</>개)`,
            format: LogFormat.YEAR_MONTH,
            year: environment.year,
            month: environment.month,
        });
    };
};

export const createMergeInheritPointRankHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): MonthlyEventActionHandler => {
    return () => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const state = world.getState();
        const isUnited = readNumber(state.meta, 'isunited') !== 0 || readNumber(state.meta, 'isUnited') !== 0;
        for (const general of world.listGenerals()) {
            let merged = 0;
            for (const key of ALL_MERGED_INHERITANCE_KEYS) {
                if (isUnited) {
                    merged += general.inheritancePoints?.[key] ?? 0;
                    continue;
                }
                if (!general.userId || general.npcState >= 2) {
                    continue;
                }
                merged += computeActiveInheritancePoint(general, key);
            }
            const actionPoint = readNumber(general.meta, 'inherit_earned_act');
            const spentDynamic = readNumber(general.meta, 'inherit_spent_dyn');
            world.updateGeneral(general.id, {
                meta: {
                    ...general.meta,
                    inherit_earned_dyn: merged,
                    inherit_earned: actionPoint + merged,
                    inherit_spent: spentDynamic,
                },
            });
        }
    };
};
