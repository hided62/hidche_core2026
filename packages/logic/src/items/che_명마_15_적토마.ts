import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_15_적토마',
    rawName: '적토마',
    slot: 'horse',
    statName: 'leadership',
    statValue: 15,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
