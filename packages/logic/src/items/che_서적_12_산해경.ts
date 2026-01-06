import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_서적_12_산해경',
    rawName: '산해경',
    slot: 'book',
    statName: 'intelligence',
    statValue: 12,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
    extraInfo: '[전투] 상대의 계략을 10% 확률로 되돌림',
});
