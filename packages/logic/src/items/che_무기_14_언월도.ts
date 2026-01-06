import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_무기_14_언월도',
    rawName: '언월도',
    slot: 'weapon',
    statName: 'strength',
    statValue: 14,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
