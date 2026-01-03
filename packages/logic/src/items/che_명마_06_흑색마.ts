import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_명마_06_흑색마',
    rawName: '흑색마',
    slot: 'horse',
    statName: 'leadership',
    statValue: 6,
    cost: 21000,
    buyable: true,
    reqSecu: 6000,
});
