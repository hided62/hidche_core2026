import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_척사_오악진형도';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '오악진형도',
    name: '오악진형도(척사)',
    info: '[전투] 지역·도시 병종 상대로 대미지 +15%, 아군 피해 -15%',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    getWarPowerMultiplier: (_context, _unit, oppose) => {
        const opposeCrewType = oppose.getCrewType();
        // In Sammo, region/city units usually have reqCities or reqRegions in crewType.
        // We'll check if those properties exist and have at least one element.
        if (
            (opposeCrewType.reqCities && opposeCrewType.reqCities.length > 0) ||
            (opposeCrewType.reqRegions && opposeCrewType.reqRegions.length > 0)
        ) {
            return [1.15, 0.85];
        }
        return [1, 1];
    },
};
