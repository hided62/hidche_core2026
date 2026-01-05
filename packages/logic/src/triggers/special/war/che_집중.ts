import type { TraitOnCalcStat, TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';

const onCalcStat = ((
    _context: GeneralActionContext | WarActionContext,
    statName: GeneralStatName | WarStatName,
    value: number | [number, number],
    _aux?: unknown
): number | [number, number] => {
    if (statName === 'warMagicSuccessDamage' && typeof value === 'number') {
        return value * 1.5;
    }
    return value;
}) as unknown as TraitOnCalcStat;

export const traitModule: TraitModule = {
    key: 'che_집중',
    name: '집중',
    info: '[전투] 계략 성공 시 대미지 +50%',
    kind: 'war',
    getName: () => '집중',
    getInfo: () => '[전투] 계략 성공 시 대미지 +50%',
    onCalcStat,
};
