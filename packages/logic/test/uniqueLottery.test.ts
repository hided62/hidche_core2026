import { describe, expect, it } from 'vitest';

import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import type { GeneralItemSlots } from '../src/domain/entities.js';
import type { ItemModule } from '../src/items/types.js';
import {
    type UniqueAcquireType,
    addOccupiedUniqueItemKeys,
    buildVoteUniqueSeed,
    countOccupiedUniqueItems,
    resolveUniqueConfig,
    rollUniqueLottery,
} from '../src/rewards/uniqueLottery.js';

const buildItem = (key: string, slot: ItemModule['slot'], buyable = false): ItemModule => ({
    key,
    rawName: key,
    name: key,
    info: key,
    slot,
    cost: null,
    buyable,
    consumable: false,
    reqSecu: 0,
    unique: !buyable,
});

describe('unique lottery', () => {
    const buildRegistry = (): Map<string, ItemModule> =>
        new Map<string, ItemModule>([['itemB', buildItem('itemB', 'weapon', false)]]);

    const buildConfig = (overrides?: Partial<ReturnType<typeof resolveUniqueConfig>>) =>
        resolveUniqueConfig({
            allItems: {
                weapon: {
                    itemB: 1,
                },
            },
            maxUniqueItemLimit: [[-1, 1]],
            uniqueTrialCoef: 10,
            maxUniqueTrialProb: 10,
            minMonthToAllowInheritItem: 0,
            ...(overrides ?? {}),
        });

    it('returns deterministic item for fixed seed', () => {
        const itemRegistry = buildRegistry();
        const config = buildConfig();

        const rngSeed = buildVoteUniqueSeed('seed', 1, 1);
        const rng = new RandUtil(LiteHashDRBG.build(rngSeed));
        const result = rollUniqueLottery({
            rng,
            config,
            itemRegistry,
            generalItems: { horse: null, weapon: null, book: null, item: null },
            occupiedUniqueCounts: new Map(),
            scenarioId: 200,
            userCount: 1,
            currentYear: 200,
            currentMonth: 1,
            startYear: 180,
            initYear: 180,
            initMonth: 1,
            acquireType: '설문조사',
        });

        expect(result).toBe('itemB');
    });

    it('supports acquire types that can yield unique items', () => {
        const itemRegistry = buildRegistry();
        const config = buildConfig();
        const acquireTypes: UniqueAcquireType[] = ['아이템', '설문조사', '랜덤 임관'];

        for (const acquireType of acquireTypes) {
            const rng = new RandUtil(LiteHashDRBG.build(buildVoteUniqueSeed('seed', 2, 2)));
            const result = rollUniqueLottery({
                rng,
                config,
                itemRegistry,
                generalItems: { horse: null, weapon: null, book: null, item: null },
                occupiedUniqueCounts: new Map(),
                scenarioId: 200,
                userCount: 1,
                currentYear: 200,
                currentMonth: 1,
                startYear: 180,
                initYear: 180,
                initMonth: 1,
                acquireType,
            });

            expect(result).toBe('itemB');
        }
    });

    it('guarantees unique on founding acquire type', () => {
        const itemRegistry = buildRegistry();
        const config = buildConfig({ uniqueTrialCoef: 0, maxUniqueTrialProb: 0 });
        const rng = new RandUtil(LiteHashDRBG.build(buildVoteUniqueSeed('seed', 3, 3)));
        const result = rollUniqueLottery({
            rng,
            config,
            itemRegistry,
            generalItems: { horse: null, weapon: null, book: null, item: null },
            occupiedUniqueCounts: new Map(),
            scenarioId: 200,
            userCount: 1,
            currentYear: 200,
            currentMonth: 1,
            startYear: 180,
            initYear: 180,
            initMonth: 1,
            acquireType: '건국',
        });

        expect(result).toBe('itemB');
    });

    it('counts only non-buyable equipped items', () => {
        const itemRegistry = new Map<string, ItemModule>([
            ['uniqueItem', buildItem('uniqueItem', 'weapon', false)],
            ['buyableItem', buildItem('buyableItem', 'book', true)],
        ]);
        const generals: GeneralItemSlots[] = [
            { horse: null, weapon: 'uniqueItem', book: null, item: null },
            { horse: null, weapon: null, book: 'buyableItem', item: null },
        ];

        const counts = countOccupiedUniqueItems(generals, itemRegistry);
        expect(counts.get('uniqueItem')).toBe(1);
        expect(counts.get('buyableItem')).toBeUndefined();
    });

    it('adds active auction and storage reservations without counting buyable items', () => {
        const itemRegistry = new Map<string, ItemModule>([
            ['uniqueItem', buildItem('uniqueItem', 'weapon', false)],
            ['buyableItem', buildItem('buyableItem', 'book', true)],
        ]);

        const counts = addOccupiedUniqueItemKeys(
            new Map([['uniqueItem', 1]]),
            ['uniqueItem', 'uniqueItem', 'buyableItem', null],
            itemRegistry
        );

        expect(counts.get('uniqueItem')).toBe(3);
        expect(counts.get('buyableItem')).toBeUndefined();
    });
});
