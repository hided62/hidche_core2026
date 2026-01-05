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
    if (statName === 'warMagicTrialProb' && typeof value === 'number') {
        return value + 0.2;
    }
    if (statName === 'warMagicSuccessProb' && typeof value === 'number') {
        return value + 0.2;
    }
    return value;
}) as unknown as TraitOnCalcStat;

export const traitModule: TraitModule = {
    key: 'che_신산',
    name: '신산',
    info: '[계략] 화계·탈취·파괴·선동 : 성공률 +10%p<br>[전투] 계략 시도 확률 +20%p, 계략 성공 확률 +20%p',
    kind: 'war',
    getName: () => '신산',
    getInfo: () => '[계략] 화계·탈취·파괴·선동 : 성공률 +10%p<br>[전투] 계략 시도 확률 +20%p, 계략 성공 확률 +20%p',
    onCalcDomestic: (_context, turnType, varType, value, _aux) => {
        if (turnType === '계략') {
            if (varType === 'success') return value + 0.1;
        }
        return value;
    },
    onCalcStat,
};
