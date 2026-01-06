import { WarUnitCity } from '@sammo-ts/logic/war/units.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = {
    key: 'che_공성_묵자',
    rawName: '묵자',
    name: '묵자(공성)',
    info: '[전투] 성벽 공격 시 대미지 +50%',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: true,
    getWarPowerMultiplier: (_context, unit) => {
        const oppose = unit.getOppose();
        if (oppose instanceof WarUnitCity) {
            return [1.5, 1];
        }
        return [1, 1];
    },
};
