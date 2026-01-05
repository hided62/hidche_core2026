import type { TraitOnCalcStat, TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';

export const traitModule: TraitModule = {
    key: 'che_안전',
    name: '안전',
    info: '사기 -5, 징·모병 비용 -20%',
    kind: 'personality',
    getName: () => '안전',
    getInfo: () => '사기 -5, 징·모병 비용 -20%',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if ((turnType === '징병' || turnType === '모병') && varType === 'cost') {
            return value * 0.8;
        }
        return value;
    },
    onCalcStat: ((
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: number | [number, number],
        _aux?: unknown
    ): number | [number, number] => {
        if (statName === 'bonusAtmos' && typeof value === 'number') {
            return value - 5;
        }
        return value;
    }) as unknown as TraitOnCalcStat,
};
