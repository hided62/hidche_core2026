import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

function onCalcStat(context: GeneralActionContext, statName: GeneralStatName, value: number, aux?: unknown): number;
function onCalcStat(
    context: WarActionContext,
    statName: WarStatName,
    value: number | [number, number],
    aux?: unknown
): number | [number, number];
function onCalcStat(
    context: GeneralActionContext | WarActionContext,
    statName: GeneralStatName | WarStatName,
    value: number | [number, number],
    aux?: unknown
): number | [number, number] {
    return value;
}

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
