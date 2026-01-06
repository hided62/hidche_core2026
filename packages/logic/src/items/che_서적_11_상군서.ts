import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_서적_11_상군서',
    rawName: '상군서',
    slot: 'book',
    statName: 'intelligence',
    statValue: 11,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
