import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_11_화종마',
    rawName: '화종마',
    slot: 'horse',
    statName: 'leadership',
    statValue: 11,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
