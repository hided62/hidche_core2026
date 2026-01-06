import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_09_쌍철극',
    rawName: '쌍철극',
    slot: 'weapon',
    statName: 'strength',
    statValue: 9,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
