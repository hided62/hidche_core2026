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
    if (statName === 'warMagicSuccessProb' && typeof value === 'number') {
        return value + 0.1;
    }
    if (statName === 'warMagicSuccessDamage' && typeof value === 'number') {
        return value * 1.3;
    }
    return value;
}) as unknown as TraitOnCalcStat;

export const traitModule: TraitModule = {
    key: 'che_환술',
    name: '환술',
    info: '[전투] 계략 성공 확률 +10%p, 계략 성공 시 대미지 +30%',
    kind: 'war',
    getName: () => '환술',
    getInfo: () => '[전투] 계략 성공 확률 +10%p, 계략 성공 시 대미지 +30%',
    onCalcStat,
};
