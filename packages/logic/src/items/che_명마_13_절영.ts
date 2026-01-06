import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_13_절영',
    rawName: '절영',
    slot: 'horse',
    statName: 'leadership',
    statValue: 13,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
