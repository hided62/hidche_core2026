import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_09_과하마',
    rawName: '과하마',
    slot: 'horse',
    statName: 'leadership',
    statValue: 9,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
