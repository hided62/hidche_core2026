import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_10_삼첨도',
    rawName: '삼첨도',
    slot: 'weapon',
    statName: 'strength',
    statValue: 10,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
