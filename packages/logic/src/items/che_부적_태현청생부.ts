import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_부적 } from '@sammo-ts/logic/war/triggers/che_부적.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_부적_태현청생부';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '태현청생부',
    name: '태현청생부(부적)',
    info: '[전투] 저격 불가, 부상 없음',
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
        if (statName === ('injuryProb' as unknown as WarStatName)) {
            return (value as number) - 1;
        }
        return value;
    } as NonNullable<ItemModule['onCalcStat']>,
    getBattlePhaseTriggerList: (context) => {
        if (!context.unit) return null;
        return new WarTriggerCaller(new che_부적(context.unit));
    },
};
