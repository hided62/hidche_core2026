import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_02_조랑',
    rawName: '조랑',
    slot: 'horse',
    statName: 'leadership',
    statValue: 2,
    cost: 3000,
    buyable: true,
    reqSecu: 2000,
});
