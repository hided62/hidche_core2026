import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_08_유성추',
    rawName: '유성추',
    slot: 'weapon',
    statName: 'strength',
    statValue: 8,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
