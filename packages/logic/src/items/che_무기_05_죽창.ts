import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_05_죽창',
    rawName: '죽창',
    slot: 'weapon',
    statName: 'strength',
    statValue: 5,
    cost: 7500,
    buyable: true,
    reqSecu: 3500,
});
