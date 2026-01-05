import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_01_노기',
    rawName: '노기',
    slot: 'horse',
    statName: 'leadership',
    statValue: 1,
    cost: 1000,
    buyable: true,
    reqSecu: 1000,
});
