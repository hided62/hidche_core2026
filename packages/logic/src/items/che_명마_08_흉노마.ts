import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_08_흉노마',
    rawName: '흉노마',
    slot: 'horse',
    statName: 'leadership',
    statValue: 8,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
