import { GeneralTriggerCaller } from '@sammo-ts/logic/triggers/general.js';
import { CheUisulCityHealTrigger } from '@sammo-ts/logic/triggers/generalTriggers/che_도시치료.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = {
    key: 'che_의술_태평청령',
    rawName: '태평청령',
    name: '태평청령(의술)',
    info: '[의술] 매달 도시의 부상병을 치료. 치료 효율 50% 향상',
    slot: 'book',
    cost: 500,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    getPreTurnExecuteTriggerList: (context) => {
        return new GeneralTriggerCaller(new CheUisulCityHealTrigger(context.general, 1.5));
    },
};
