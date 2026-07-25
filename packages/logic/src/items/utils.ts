import type { ScenarioConfig } from '@sammo-ts/logic/scenario/types.js';
import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { ItemModule } from './types.js';
import { consumeEquippedItemCharge, ensureItemInventory, getEquippedItemInstance } from './inventory.js';

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
    const inventory = ensureItemInventory(general);
    const items = (['horse', 'weapon', 'book', 'item'] as const).map((slot) => {
        const instanceId = inventory.equipped[slot];
        return instanceId ? (inventory.instances[instanceId]?.itemKey ?? null) : null;
    });
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
    const instance = getEquippedItemInstance(general, 'item');
    const value = instance?.itemKey === itemKey ? instance.state.charges : undefined;
    return typeof value === 'number' && value > 0 ? value : null;
};

export const setItemRemain = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>,
    itemKey: string,
    remain: number | null
): void => {
    const instance = getEquippedItemInstance(general, 'item');
    if (!instance || instance.itemKey !== itemKey) {
        return;
    }
    if (remain === null || remain <= 0) {
        delete instance.state.charges;
        return;
    }
    instance.state.charges = remain;
};

export const consumeItemRemain = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>,
    itemKey: string,
    fallbackRemain = 1
): boolean => {
    return consumeEquippedItemCharge(general, 'item', itemKey, fallbackRemain);
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
