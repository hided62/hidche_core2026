import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_서적_12_맹덕신서',
    rawName: '맹덕신서',
    slot: 'book',
    statName: 'intelligence',
    statValue: 12,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
