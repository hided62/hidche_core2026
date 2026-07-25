import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_04_나귀',
    rawName: '나귀',
    slot: 'horse',
    statName: 'leadership',
    statValue: 4,
    cost: 10000,
    buyable: true,
    reqSecu: 4000,
});
