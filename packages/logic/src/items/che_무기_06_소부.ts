import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_06_소부',
    rawName: '소부',
    slot: 'weapon',
    statName: 'strength',
    statValue: 6,
    cost: 9000,
    buyable: true,
    reqSecu: 4000,
});
