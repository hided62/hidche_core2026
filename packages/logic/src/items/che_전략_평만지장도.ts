import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_전략_평만지장도';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '평만지장도',
    name: '평만지장도(전략)',
    info: '[전략] 국가전략 사용시 재사용 대기 기간 -20%',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    onCalcStrategic: (_context, _turnType, varType, value) => {
        if (varType === 'delay') {
            return Math.round(value * 0.8);
        }
        return value;
    },
};
