import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_계략_이추';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '이추',
    name: '이추(계략)',
    info: '[계략] 화계·탈취·파괴·선동 : 성공률 +20%p',
    slot: 'item',
    cost: 1000,
    buyable: true,
    consumable: true,
    reqSecu: 1000,
    unique: false,
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '계략' && varType === 'success') {
            return value + 0.2;
        }
        return value;
    },
};
