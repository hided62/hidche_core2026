import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_08_철질여골',
    rawName: '철질여골',
    slot: 'weapon',
    statName: 'strength',
    statValue: 8,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
