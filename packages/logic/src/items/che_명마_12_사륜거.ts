import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_퇴각부상무효 } from '@sammo-ts/logic/war/triggers/che_퇴각부상무효.js';
import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

const baseModule = createStatItemModule({
    key: 'che_명마_12_사륜거',
    rawName: '사륜거',
    slot: 'horse',
    statName: 'leadership',
    statValue: 12,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
    extraInfo: '[전투] 전투 종료로 인한 부상 없음',
});

export const itemModule: ItemModule = {
    ...baseModule,
    getBattleInitTriggerList: (context) => {
        if (!context.unit) {
            return null;
        }
        return new WarTriggerCaller(new che_퇴각부상무효(context.unit));
    },
};
