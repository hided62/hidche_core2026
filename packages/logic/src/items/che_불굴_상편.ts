import { clamp } from '@sammo-ts/logic/war/utils.js';
import { WarUnitGeneral } from '@sammo-ts/logic/war/units.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_불굴_상편';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '상편',
    name: '상편(불굴)',
    info: '[전투] 남은 병력이 적을수록 공격력 증가. 최대 +60%',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    getWarPowerMultiplier: (_context, unit, _oppose) => {
        if (!(unit instanceof WarUnitGeneral)) {
            return [1, 1];
        }
        const general = unit.getGeneral();
        const leadership = general.stats.leadership;
        const crew = general.crew;
        const crewRatio = clamp(crew / (leadership * 100), 0, 1);
        return [1 + 0.6 * (1 - crewRatio), 1];
    },
};
