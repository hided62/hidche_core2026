import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_13_양유기궁',
    rawName: '양유기궁',
    slot: 'weapon',
    statName: 'strength',
    statValue: 13,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
