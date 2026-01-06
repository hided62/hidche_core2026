import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_서적_10_시경',
    rawName: '시경',
    slot: 'book',
    statName: 'intelligence',
    statValue: 10,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
