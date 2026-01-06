import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_10_대완마',
    rawName: '대완마',
    slot: 'horse',
    statName: 'leadership',
    statValue: 10,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
