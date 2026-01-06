import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_05_갈색마',
    rawName: '갈색마',
    slot: 'horse',
    statName: 'leadership',
    statValue: 5,
    cost: 7500,
    buyable: true,
    reqSecu: 3500,
});
