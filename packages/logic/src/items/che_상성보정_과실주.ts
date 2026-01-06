import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_상성보정_과실주';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '과실주',
    name: '과실주(상성)',
    info: '[전투] 대등/유리한 병종 전투시 공격력 +10%, 피해 -10%',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    getWarPowerMultiplier: (_context, unit, oppose) => {
        const attackCoef = unit.getCrewType().getAttackCoef(oppose.getCrewType());
        if (attackCoef < 1) {
            return [1, 1];
        }
        return [1.1, 0.9];
    },
};
