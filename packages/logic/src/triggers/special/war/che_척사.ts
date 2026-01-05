import type { TraitOnCalcStat, TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';

const onCalcStat = ((
    _context: GeneralActionContext | WarActionContext,
    _statName: GeneralStatName | WarStatName,
    value: number | [number, number],
    _aux?: unknown
): number | [number, number] => {
    return value;
}) as unknown as TraitOnCalcStat;

export const traitModule: TraitModule = {
    key: 'che_척사',
    name: '척사',
    info: '[전투] 지역·도시 병종 상대로 대미지 +20%, 아군 피해 -20%',
    kind: 'war',
    getName: () => '척사',
    getInfo: () => '[전투] 지역·도시 병종 상대로 대미지 +20%, 아군 피해 -20%',
    getWarPowerMultiplier: (_context, _unit, oppose) => {
        const opposeCrewType = oppose.getCrewType();
        if (opposeCrewType.reqCities() || opposeCrewType.reqRegions()) {
            return [1.2, 0.8];
        }
        return [1, 1];
    },
    onCalcStat,
};
