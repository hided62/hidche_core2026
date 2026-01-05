import { GeneralTriggerCaller } from '@sammo-ts/logic/triggers/general.js';
import { CheItemHealTrigger } from '@sammo-ts/logic/triggers/generalTriggers/che_아이템치료.js';
import { consumeItemRemain, setItemRemain } from './utils.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_치료_환약';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '환약',
    name: '환약(치료)',
    info: '[군사] 턴 실행 전 부상 회복. 3회용',
    slot: 'item',
    cost: 200,
    buyable: true,
    consumable: true,
    reqSecu: 0,
    unique: false,
    getPreTurnExecuteTriggerList: (context) => {
        const target = context.general.triggerState.meta['use_treatment'];
        const injuryTarget = typeof target === 'number' && Number.isFinite(target) ? target : 10;
        return new GeneralTriggerCaller(
            new CheItemHealTrigger(context.general, {
                injuryTarget,
                itemKey: ITEM_KEY,
                itemName: '환약(치료)',
                itemRawName: '환약',
                consume: () => consumeItemRemain(context.general, ITEM_KEY, 1),
            })
        );
    },
    onArbitraryAction: (context, actionType, phase, aux) => {
        if (actionType !== '장비매매' || phase !== '구매') {
            return aux ?? null;
        }
        setItemRemain(context.general, ITEM_KEY, 3);
        return aux ?? null;
    },
};
