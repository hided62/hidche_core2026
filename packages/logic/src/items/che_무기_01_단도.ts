import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_01_단도',
    rawName: '단도',
    slot: 'weapon',
    statName: 'strength',
    statValue: 1,
    cost: 1000,
    buyable: true,
    reqSecu: 1000,
});
