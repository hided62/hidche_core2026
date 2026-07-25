import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';
import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_반계발동, che_반계시도 } from '@sammo-ts/logic/war/triggers/che_반계.js';

const baseModule = createStatItemModule({
    key: 'che_서적_12_산해경',
    rawName: '산해경',
    slot: 'book',
    statName: 'intelligence',
    statValue: 12,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
    extraInfo: '[전투] 상대의 계략을 10% 확률로 되돌림',
});

export const itemModule: ItemModule = {
    ...baseModule,
    getBattlePhaseTriggerList: (context) =>
        context.unit ? new WarTriggerCaller(new che_반계시도(context.unit, 0.1), new che_반계발동(context.unit)) : null,
};
