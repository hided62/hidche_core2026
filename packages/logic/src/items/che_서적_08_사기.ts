import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_서적_08_사기',
    rawName: '사기',
    slot: 'book',
    statName: 'intelligence',
    statValue: 8,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
