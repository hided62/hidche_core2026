import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_15_한혈마',
    rawName: '한혈마',
    slot: 'horse',
    statName: 'leadership',
    statValue: 15,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
