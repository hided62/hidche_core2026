import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_계략_향낭';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '향낭',
    name: '향낭(계략)',
    info: '[계략] 화계·탈취·파괴·선동 : 성공률 +50%p',
    slot: 'item',
    cost: 3000,
    buyable: true,
    consumable: true,
    reqSecu: 2000,
    unique: false,
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '계략' && varType === 'success') {
            return value + 0.5;
        }
        return value;
    },
};
