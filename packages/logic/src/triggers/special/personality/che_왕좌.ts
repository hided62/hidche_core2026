import type { TraitOnCalcStat, TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';

export const traitModule: TraitModule = {
    key: 'che_왕좌',
    name: '왕좌',
    info: '명성 +10%, 사기 -5',
    kind: 'personality',
    getName: () => '왕좌',
    getInfo: () => '명성 +10%, 사기 -5',
    onCalcStat: ((
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: number | [number, number],
        _aux?: unknown
    ): number | [number, number] => {
        if (typeof value === 'number') {
            if (statName === 'experience') {
                return value * 1.1;
            }
            if (statName === 'bonusAtmos') {
                return value - 5;
            }
        }
        return value;
    }) as unknown as TraitOnCalcStat,
};
