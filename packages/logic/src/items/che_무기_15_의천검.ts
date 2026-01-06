import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_15_의천검',
    rawName: '의천검',
    slot: 'weapon',
    statName: 'strength',
    statValue: 15,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
