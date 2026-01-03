import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';

const STAT_VALUE = 3;

const baseModule = createStatItemModule({
    key: 'che_서적_03_변도론',
    rawName: '변도론',
    slot: 'book',
    statName: 'intelligence',
    statValue: STAT_VALUE,
    cost: 6000,
    buyable: true,
    reqSecu: 3000,
    extraInfo: '[전투] 계략 시도 확률 +2%p',
});

export const itemModule: ItemModule = {
    ...baseModule,
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
            let base = value;
            if (statName === 'intelligence' && !Array.isArray(base)) {
                base = base + STAT_VALUE;
            }
            if (statName === 'warMagicTrialProb') {
                return Array.isArray(base) ? base : base + 0.02;
            }
            return base;
        }
        return onCalcStat;
    })() as Exclude<ItemModule['onCalcStat'], undefined>,
};
