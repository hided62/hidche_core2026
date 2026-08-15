import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { consumeEquippedItemCharge, readItemInventory } from './inventory.js';

export const listEquippedItemKeys = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>
): string[] => {
    const inventory = readItemInventory(general);
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

export const consumeItemRemain = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>,
    itemKey: string,
    fallbackRemain = 1
): boolean => {
    return consumeEquippedItemCharge(general, 'item', itemKey, fallbackRemain);
};
