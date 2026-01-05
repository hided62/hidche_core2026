import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';

export const traitModule: TraitModule = {
    key: 'che_패권',
    name: '패권',
    info: '훈련 +5, 징·모병 비용 +20%',
    kind: 'personality',
    getName: () => '패권',
    getInfo: () => '훈련 +5, 징·모병 비용 +20%',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if ((turnType === '징병' || turnType === '모병') && varType === 'cost') {
            return value * 1.2;
        }
        return value;
    },
    onCalcStat: (() => {
        function onCalcStat(
            _context: GeneralActionContext,
            statName: GeneralStatName,
            value: number,
            _aux?: unknown
        ): number;
        function onCalcStat(
            _context: WarActionContext,
            statName: WarStatName,
            value: number | [number, number],
            _aux?: unknown
        ): number | [number, number];
        function onCalcStat(
            _context: GeneralActionContext | WarActionContext,
            statName: GeneralStatName | WarStatName,
            value: number | [number, number]
        ): number | [number, number] {
            if (statName === 'bonusTrain' && typeof value === 'number') {
                return value + 5;
            }
            return value;
        }
        return onCalcStat;
    })() as Exclude<TraitModule['onCalcStat'], undefined>,
};
