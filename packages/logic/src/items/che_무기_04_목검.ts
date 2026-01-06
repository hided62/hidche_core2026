import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_04_목검',
    rawName: '목검',
    slot: 'weapon',
    statName: 'strength',
    statValue: 4,
    cost: 6000,
    buyable: true,
    reqSecu: 3000,
});
