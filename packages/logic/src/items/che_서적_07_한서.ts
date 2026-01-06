import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_서적_07_한서',
    rawName: '한서',
    slot: 'book',
    statName: 'intelligence',
    statValue: 7,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
