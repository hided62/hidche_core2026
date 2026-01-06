import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_03_노새',
    rawName: '노새',
    slot: 'horse',
    statName: 'leadership',
    statValue: 3,
    cost: 4500,
    buyable: true,
    reqSecu: 2500,
});
