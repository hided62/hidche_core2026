import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_07_맥궁',
    rawName: '맥궁',
    slot: 'weapon',
    statName: 'strength',
    statValue: 7,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
