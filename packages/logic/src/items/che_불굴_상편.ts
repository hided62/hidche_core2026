import { clamp } from '@sammo-ts/logic/war/utils.js';
import { WarUnitGeneral } from '@sammo-ts/logic/war/units.js';
import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { 전투력보정 } from '@sammo-ts/logic/war/triggers/전투력보정.js';
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
    getBattlePhaseTriggerList: (context) => {
        const unit = context.unit;
        if (!(unit instanceof WarUnitGeneral)) {
            return null;
        }
        const general = unit.getGeneral();
        const leadership = general.stats.leadership;
        const crew = general.crew;
        const crewRatio = clamp(crew / (leadership * 100), 0, 1);
        return new WarTriggerCaller(new 전투력보정(unit, 1 + 0.6 * (1 - crewRatio)));
    },
};
