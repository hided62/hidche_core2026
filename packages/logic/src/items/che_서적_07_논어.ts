import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

const baseModule = createStatItemModule({
    key: 'che_서적_07_논어',
    rawName: '논어',
    slot: 'book',
    statName: 'intelligence',
    statValue: 7,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
    extraInfo: '[전투] 상대의 계략 성공 확률 -10%p',
});

export const itemModule: ItemModule = {
    ...baseModule,
    onCalcOpposeStat: function (
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: unknown,
        _aux?: unknown
    ): unknown {
        if (statName === 'warMagicSuccessProb') {
            return (value as number) - 0.1;
        }
        return value;
    } as NonNullable<ItemModule['onCalcOpposeStat']>,
};
