import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_11_고정도',
    rawName: '고정도',
    slot: 'weapon',
    statName: 'strength',
    statValue: 11,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
