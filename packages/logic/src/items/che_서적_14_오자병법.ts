import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_서적_14_오자병법',
    rawName: '오자병법',
    slot: 'book',
    statName: 'intelligence',
    statValue: 14,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
