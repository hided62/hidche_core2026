import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/actionModules/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

const STAT_VALUE = 12;

const baseModule = createStatItemModule({
    key: 'che_명마_12_옥란백용구',
    rawName: '옥란백용구',
    slot: 'horse',
    statName: 'leadership',
    statValue: STAT_VALUE,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
    extraInfo: '[전투] 남은 병력이 적을수록 회피 확률 증가. 최대 +50%p',
});

export const itemModule: ItemModule = {
    ...baseModule,
    onCalcStat: function (
        context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: number | [number, number],
        aux?: unknown
    ): number | [number, number] {
        let newValue: number | [number, number] = value;
        if (statName === 'leadership' && typeof value === 'number') {
            newValue = value + STAT_VALUE;
        }
        if (statName === 'warAvoidRatio' && typeof newValue === 'number') {
            const leadership =
                typeof aux === 'object' && aux !== null && 'leadership' in aux && typeof aux.leadership === 'number'
                    ? aux.leadership
                    : context.general.stats.leadership + STAT_VALUE;
            const crewL = context.general.crew / 100;
            const boost = (1 - crewL / leadership) * 0.5;
            return newValue + Math.min(Math.max(boost, 0), 0.5);
        }
        return newValue;
    } as NonNullable<ItemModule['onCalcStat']>,
};
