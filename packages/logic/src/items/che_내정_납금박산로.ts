import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_내정_납금박산로';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '납금박산로',
    name: '납금박산로(내정)',
    info: '[내정] 내정 성공률 +15%p',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (['상업', '농업', '기술', '성벽', '수비', '치안', '민심', '인구'].includes(turnType)) {
            if (varType === 'success') return value + 0.15;
        }
        return value;
    },
};
