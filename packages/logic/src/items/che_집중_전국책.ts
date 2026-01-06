import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = {
    key: 'che_집중_전국책',
    rawName: '전국책',
    name: '전국책(집중)',
    info: '[전투] 계략 성공 시 대미지 +30%',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: true,
    onCalcStat: function (
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: unknown
    ): unknown {
        if (statName === 'warMagicSuccessDamage') {
            return (value as number) * 1.3;
        }
        return value;
    } as NonNullable<ItemModule['onCalcStat']>,
};
