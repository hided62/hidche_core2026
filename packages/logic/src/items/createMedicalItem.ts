import { GeneralTriggerCaller } from '@sammo-ts/logic/triggers/general.js';
import { CheUisulCityHealTrigger } from '@sammo-ts/logic/triggers/generalTriggers/che_도시치료.js';
import { triggerModule as medicalWarTriggerModule } from '@sammo-ts/logic/war/triggers/che_의술.js';
import type { ItemModule } from './types.js';

const INFO =
    '[군사] 매 턴마다 자신(100%)과 소속 도시 장수(적 포함 50%) 부상 회복<br>[전투] 페이즈마다 40% 확률로 치료 발동(아군 피해 30% 감소, 부상 회복)';

export const createMedicalItem = (key: string, rawName: string): ItemModule => ({
    key,
    rawName,
    name: `${rawName}(의술)`,
    info: INFO,
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: true,
    getPreTurnExecuteTriggerList: (context) => new GeneralTriggerCaller(new CheUisulCityHealTrigger(context.general)),
    getBattlePhaseTriggerList: (context) =>
        context.unit ? medicalWarTriggerModule.createTriggerList(context.unit) : null,
});
