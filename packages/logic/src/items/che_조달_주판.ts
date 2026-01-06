import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_조달_주판';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '주판',
    name: '주판(조달)',
    info: '[내정] 물자조달 성공 확률 +20%p, 물자조달 획득량 +100%p',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '조달') {
            if (varType === 'success') return value + 0.2;
            if (varType === 'score') return value * 2;
        }
        return value;
    },
};
