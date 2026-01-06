import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_14_조황비전',
    rawName: '조황비전',
    slot: 'horse',
    statName: 'leadership',
    statValue: 14,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
