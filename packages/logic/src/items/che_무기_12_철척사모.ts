import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_12_철척사모',
    rawName: '철척사모',
    slot: 'weapon',
    statName: 'strength',
    statValue: 12,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
