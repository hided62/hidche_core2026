import type {
    General,
    GeneralItemInstance,
    GeneralItemInventory,
    GeneralItemInstanceState,
    GeneralItemSlot,
    GeneralItemSlots,
    GeneralTriggerState,
    TriggerValue,
} from '@sammo-ts/logic/domain/entities.js';

const ITEM_SLOTS: GeneralItemSlot[] = ['horse', 'weapon', 'book', 'item'];
const INVENTORY_META_KEY = 'itemInventory';

const emptyState = (): GeneralItemInstanceState => ({ values: {} });

const cloneState = (state: GeneralItemInstanceState): GeneralItemInstanceState => ({
    ...(state.charges === undefined ? {} : { charges: state.charges }),
    values: { ...state.values },
});

export const createItemInventoryFromSlots = (slots: GeneralItemSlots): GeneralItemInventory => {
    const inventory: GeneralItemInventory = {
        nextInstanceId: 1,
        instances: {},
        equipped: {},
    };
    for (const slot of ITEM_SLOTS) {
        const itemKey = slots[slot];
        if (!itemKey || itemKey === 'None') {
            continue;
        }
        const id = `legacy:${slot}`;
        inventory.instances[id] = { id, itemKey, state: emptyState() };
        inventory.equipped[slot] = id;
    }
    return inventory;
};

export const cloneItemInventory = (inventory: GeneralItemInventory): GeneralItemInventory => ({
    nextInstanceId: inventory.nextInstanceId,
    instances: Object.fromEntries(
        Object.entries(inventory.instances).map(([id, instance]) => [
            id,
            { ...instance, state: cloneState(instance.state) },
        ])
    ),
    equipped: { ...inventory.equipped },
});

const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const readState = (value: unknown): GeneralItemInstanceState | null => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const charges =
        typeof record['charges'] === 'number' && Number.isInteger(record['charges']) && record['charges'] >= 0
            ? record['charges']
            : undefined;
    const valuesRecord = asRecord(record['values']) ?? {};
    const values: Record<string, TriggerValue> = {};
    for (const [key, entry] of Object.entries(valuesRecord)) {
        if (
            typeof entry === 'boolean' ||
            typeof entry === 'number' ||
            typeof entry === 'string' ||
            (typeof entry === 'object' && entry !== null && !Array.isArray(entry))
        ) {
            values[key] = entry as TriggerValue;
        }
    }
    return { ...(charges === undefined ? {} : { charges }), values };
};

export const parseItemInventory = (value: unknown, fallbackSlots: GeneralItemSlots): GeneralItemInventory => {
    const record = asRecord(value);
    if (!record) {
        return createItemInventoryFromSlots(fallbackSlots);
    }
    const rawInstances = asRecord(record['instances']);
    const rawEquipped = asRecord(record['equipped']);
    const nextInstanceId =
        typeof record['nextInstanceId'] === 'number' &&
        Number.isInteger(record['nextInstanceId']) &&
        record['nextInstanceId'] > 0
            ? record['nextInstanceId']
            : 1;
    if (!rawInstances || !rawEquipped) {
        return createItemInventoryFromSlots(fallbackSlots);
    }

    const inventory: GeneralItemInventory = {
        nextInstanceId,
        instances: {},
        equipped: {},
    };
    for (const [id, rawInstance] of Object.entries(rawInstances)) {
        const instance = asRecord(rawInstance);
        const itemKey = instance?.['itemKey'];
        const state = readState(instance?.['state']);
        if (typeof itemKey !== 'string' || !itemKey || !state) {
            continue;
        }
        inventory.instances[id] = { id, itemKey, state };
    }
    for (const slot of ITEM_SLOTS) {
        const instanceId = rawEquipped[slot];
        if (typeof instanceId === 'string' && inventory.instances[instanceId]) {
            inventory.equipped[slot] = instanceId;
        }
    }
    return inventory;
};

export const readItemInventoryFromMeta = (
    meta: Record<string, unknown>,
    fallbackSlots: GeneralItemSlots
): GeneralItemInventory => parseItemInventory(meta[INVENTORY_META_KEY], fallbackSlots);

export const serializeItemInventory = (inventory: GeneralItemInventory): Record<string, TriggerValue> => ({
    nextInstanceId: inventory.nextInstanceId,
    instances: Object.fromEntries(
        Object.entries(inventory.instances).map(([id, instance]) => [
            id,
            {
                itemKey: instance.itemKey,
                state: {
                    ...(instance.state.charges === undefined ? {} : { charges: instance.state.charges }),
                    values: instance.state.values,
                },
            },
        ])
    ),
    equipped: { ...inventory.equipped },
});

export const withSerializedItemInventory = <T extends Record<string, unknown>>(
    meta: T,
    inventory: GeneralItemInventory
): T & { itemInventory: Record<string, TriggerValue> } => ({
    ...meta,
    itemInventory: serializeItemInventory(inventory),
});

export const ensureItemInventory = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>
): GeneralItemInventory => {
    if (!general.itemInventory) {
        general.itemInventory = createItemInventoryFromSlots(general.role.items);
    }
    return general.itemInventory;
};

export const readItemInventory = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>
): GeneralItemInventory => general.itemInventory ?? createItemInventoryFromSlots(general.role.items);

export const projectItemSlots = (inventory: GeneralItemInventory): GeneralItemSlots => {
    const slots: GeneralItemSlots = { horse: null, weapon: null, book: null, item: null };
    for (const slot of ITEM_SLOTS) {
        const instanceId = inventory.equipped[slot];
        slots[slot] = instanceId ? (inventory.instances[instanceId]?.itemKey ?? null) : null;
    }
    return slots;
};

export const getEquippedItemInstance = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>,
    slot: GeneralItemSlot
): GeneralItemInstance | null => {
    const inventory = readItemInventory(general);
    const instanceId = inventory.equipped[slot];
    return instanceId ? (inventory.instances[instanceId] ?? null) : null;
};

export const equipNewItem = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>,
    slot: GeneralItemSlot,
    itemKey: string,
    initialState: Partial<GeneralItemInstanceState> = {}
): GeneralItemInstance => {
    const inventory = ensureItemInventory(general);
    const previousId = inventory.equipped[slot];
    if (previousId) {
        delete inventory.instances[previousId];
    }
    const id = `${general.id}:${inventory.nextInstanceId}`;
    inventory.nextInstanceId += 1;
    const instance: GeneralItemInstance = {
        id,
        itemKey,
        state: {
            ...(initialState.charges === undefined ? {} : { charges: initialState.charges }),
            values: { ...(initialState.values ?? {}) },
        },
    };
    inventory.instances[id] = instance;
    inventory.equipped[slot] = id;
    general.role.items[slot] = itemKey;
    return instance;
};

export const removeEquippedItem = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>,
    slot: GeneralItemSlot
): GeneralItemInstance | null => {
    const inventory = ensureItemInventory(general);
    const instanceId = inventory.equipped[slot];
    const instance = instanceId ? (inventory.instances[instanceId] ?? null) : null;
    if (instanceId) {
        delete inventory.instances[instanceId];
    }
    delete inventory.equipped[slot];
    general.role.items[slot] = null;
    return instance;
};

export const consumeEquippedItemCharge = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>,
    slot: GeneralItemSlot,
    itemKey: string,
    fallbackCharges = 1
): boolean => {
    const inventory = ensureItemInventory(general);
    const instanceId = inventory.equipped[slot];
    const instance = instanceId ? inventory.instances[instanceId] : undefined;
    if (!instance || instance.itemKey !== itemKey) {
        return false;
    }
    const charges = instance.state.charges ?? fallbackCharges;
    if (charges > 1) {
        instance.state.charges = charges - 1;
        return false;
    }
    removeEquippedItem(general, slot);
    return true;
};
