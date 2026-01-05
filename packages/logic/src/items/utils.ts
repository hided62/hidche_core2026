import type { ScenarioConfig } from '@sammo-ts/logic/scenario/types.js';
import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { ItemModule } from './types.js';

const ITEM_REMAIN_PREFIX = 'itemRemain:';

const toBoolean = (value: unknown): boolean => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value > 0;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'true' || normalized === 'yes' || normalized === '1';
    }
    return false;
};

export const isInventoryEnabled = (config: ScenarioConfig): boolean => {
    const constConfig = config.const ?? {};
    return toBoolean(
        constConfig['allowInventory'] ?? constConfig['inventoryEnabled'] ?? constConfig['enableInventory']
    );
};

export const listEquippedItemKeys = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>
): string[] => {
    const items = [
        general.role.items.horse,
        general.role.items.weapon,
        general.role.items.book,
        general.role.items.item,
    ];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const key of items) {
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(key);
    }
    return result;
};

export const getItemRemain = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>,
    itemKey: string
): number | null => {
    const value = general.triggerState.counters[`${ITEM_REMAIN_PREFIX}${itemKey}`];
    return typeof value === 'number' && value > 0 ? value : null;
};

export const setItemRemain = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>,
    itemKey: string,
    remain: number | null
): void => {
    const key = `${ITEM_REMAIN_PREFIX}${itemKey}`;
    if (remain === null || remain <= 0) {
        delete general.triggerState.counters[key];
        return;
    }
    general.triggerState.counters[key] = remain;
};

export const consumeItemRemain = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>,
    itemKey: string,
    fallbackRemain = 1
): boolean => {
    const remain = getItemRemain(general, itemKey) ?? fallbackRemain;
    if (remain > 1) {
        setItemRemain(general, itemKey, remain - 1);
        return false;
    }
    setItemRemain(general, itemKey, null);
    return true;
};

export const canAcquireItem = <TriggerState extends GeneralTriggerState>(options: {
    general: General<TriggerState>;
    item: ItemModule;
    config: ScenarioConfig;
    registry: Map<string, ItemModule>;
}): boolean => {
    const { general, item, config, registry } = options;
    if (!item.unique) {
        return true;
    }
    if (isInventoryEnabled(config)) {
        return true;
    }
    const slotItemKey = general.role.items[item.slot];
    if (!slotItemKey) {
        return true;
    }
    const slotItem = registry.get(slotItemKey);
    if (!slotItem) {
        return true;
    }
    return !slotItem.unique;
};
