import { GeneralTriggerCaller } from '@sammo-ts/logic/triggers/general.js';
import { CheUisulCityHealTrigger } from '@sammo-ts/logic/triggers/generalTriggers/che_도시치료.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = {
    key: 'che_의술_정력견혈산',
    rawName: '정력견혈산',
    name: '정력견혈산(의술)',
    info: '[의술] 매달 도시의 부상병을 치료. 치료 효율 100% 향상',
    slot: 'book',
    cost: 500,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    getPreTurnExecuteTriggerList: (context) => {
        return new GeneralTriggerCaller(new CheUisulCityHealTrigger(context.general, 2));
    },
};
