import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = createStatItemModule({
    key: 'che_서적_07_사마법',
    rawName: '사마법',
    slot: 'book',
    statName: 'intelligence',
    statValue: 7,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
    extraInfo: '[전투] 상대의 계략을 10% 확률로 되돌림',
});
