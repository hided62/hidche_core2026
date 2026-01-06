import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_행동_서촉지형도';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '서촉지형도',
    name: '서촉지형도(행동)',
    info: '[전투] 공격 시 페이즈 + 2',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    onCalcStat: function (
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: unknown
    ): unknown {
        if (statName === 'initWarPhase') {
            return (value as number) + 2;
        }
        return value;
    } as NonNullable<ItemModule['onCalcStat']>,
};
