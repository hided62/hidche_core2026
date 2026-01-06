import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_서적_09_역경',
    rawName: '역경',
    slot: 'book',
    statName: 'intelligence',
    statValue: 9,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
