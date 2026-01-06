import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_03_단극',
    rawName: '단극',
    slot: 'weapon',
    statName: 'strength',
    statValue: 3,
    cost: 4500,
    buyable: true,
    reqSecu: 2500,
});
