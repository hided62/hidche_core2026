import type { TraitOnCalcStat, TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';

export const traitModule: TraitModule = {
    key: 'che_출세',
    name: '출세',
    info: '명성 +10%, 징·모병 비용 +20%',
    kind: 'personality',
    getName: () => '출세',
    getInfo: () => '명성 +10%, 징·모병 비용 +20%',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if ((turnType === '징병' || turnType === '모병') && varType === 'cost') {
            return value * 1.2;
        }
        return value;
    },
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
            if (statName === 'bonusTrain') {
                return value + 5;
            }
        }
        return value;
    }) as unknown as TraitOnCalcStat,
};
