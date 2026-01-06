import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_서적_13_관자',
    rawName: '관자',
    slot: 'book',
    statName: 'intelligence',
    statValue: 13,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
