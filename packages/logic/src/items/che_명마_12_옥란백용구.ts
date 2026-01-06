import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

const baseModule = createStatItemModule({
    key: 'che_명마_12_옥란백용구',
    rawName: '옥란백용구',
    slot: 'horse',
    statName: 'leadership',
    statValue: 12,
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
        value: unknown,
        aux?: unknown
    ): unknown {
        const newValue = baseModule.onCalcStat!(
            context as unknown as GeneralActionContext,
            statName as unknown as GeneralStatName,
            value as unknown as number,
            aux
        );
        if (statName === 'warAvoidRatio') {
            const { leadership } = (context as unknown as GeneralActionContext).general.stats;
            const crewL = (context as unknown as GeneralActionContext).general.crew / 100;
            const boost = (1 - crewL / leadership) * 0.5;
            return (newValue as number) + Math.min(Math.max(boost, 0), 0.5);
        }
        return newValue;
    } as NonNullable<ItemModule['onCalcStat']>,
};
