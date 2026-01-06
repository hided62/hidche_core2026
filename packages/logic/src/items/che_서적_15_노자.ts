import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_서적_15_노자',
    rawName: '노자',
    slot: 'book',
    statName: 'intelligence',
    statValue: 15,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
