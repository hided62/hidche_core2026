import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_07_오환마',
    rawName: '오환마',
    slot: 'horse',
    statName: 'leadership',
    statValue: 7,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
});
