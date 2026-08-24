import { describe, expect, it } from 'vitest';

import type { General } from '../src/domain/entities.js';
import {
    consumeEquippedItemCharge,
    createItemInventoryFromSlots,
    equipNewItem,
    getEquippedItemInstance,
    parseItemInventory,
    projectItemSlots,
    serializeItemInventory,
} from '../src/items/inventory.js';
import { listEquippedItemKeys } from '../src/items/utils.js';

const makeGeneral = (): General => ({
    id: 7,
    name: '테스트',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    experience: 0,
    dedication: 0,
    officerLevel: 0,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 30,
    gold: 1000,
    rice: 1000,
    crew: 1000,
    crewTypeId: 1100,
    train: 100,
    atmos: 100,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
});

describe('GeneralItemInventory', () => {
    it('upgrades legacy equipped columns into canonical item instances', () => {
        const inventory = createItemInventoryFromSlots({
            horse: 'che_명마_01_노기',
            weapon: null,
            book: 'che_서적_01_효경전',
            item: 'che_치료_환약',
        });

        expect(projectItemSlots(inventory)).toEqual({
            horse: 'che_명마_01_노기',
            weapon: null,
            book: 'che_서적_01_효경전',
            item: 'che_치료_환약',
        });
        expect(Object.keys(inventory.instances)).toHaveLength(3);
    });

    it('reads legacy slots without mutating a frozen world snapshot', () => {
        const general = makeGeneral();
        general.role.items.item = 'che_치료_환약';
        const frozen = Object.freeze(general);

        expect(listEquippedItemKeys(frozen)).toEqual(['che_치료_환약']);
        expect(getEquippedItemInstance(frozen, 'item')?.itemKey).toBe('che_치료_환약');
        expect(frozen.itemInventory).toBeUndefined();
    });

    it('keeps consumable charges in the equipped item instance', () => {
        const general = makeGeneral();
        equipNewItem(general, 'item', 'che_치료_환약', { charges: 3 });

        expect(consumeEquippedItemCharge(general, 'item', 'che_치료_환약')).toBe(false);
        expect(getEquippedItemInstance(general, 'item')?.state.charges).toBe(2);
        expect(consumeEquippedItemCharge(general, 'item', 'che_치료_환약')).toBe(false);
        expect(consumeEquippedItemCharge(general, 'item', 'che_치료_환약')).toBe(true);
        expect(general.role.items.item).toBeNull();
        expect(getEquippedItemInstance(general, 'item')).toBeNull();
    });

    it('round-trips inventory state through the persisted meta representation', () => {
        const general = makeGeneral();
        equipNewItem(general, 'item', 'che_치료_환약', {
            charges: 2,
            values: { source: 'shop' },
        });
        const serialized = serializeItemInventory(general.itemInventory!);
        const parsed = parseItemInventory(serialized, {
            horse: null,
            weapon: null,
            book: null,
            item: null,
        });

        expect(projectItemSlots(parsed).item).toBe('che_치료_환약');
        expect(Object.values(parsed.instances)[0]?.state).toEqual({
            charges: 2,
            values: { source: 'shop' },
        });
    });

    it('round-trips the negative remain value produced by the legacy ram lifecycle', () => {
        const general = makeGeneral();
        equipNewItem(general, 'item', 'event_충차', { charges: -1 });

        const parsed = parseItemInventory(serializeItemInventory(general.itemInventory!), general.role.items);

        expect(getEquippedItemInstance({ ...general, itemInventory: parsed }, 'item')?.state.charges).toBe(-1);
    });
});
