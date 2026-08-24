import { GeneralTriggerCaller } from '@sammo-ts/logic/triggers/general.js';
import { CheUisulCityHealTrigger } from '@sammo-ts/logic/triggers/generalTriggers/che_도시치료.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_의술발동, che_의술시도 } from '@sammo-ts/logic/war/triggers/che_의술.js';
import type { ItemModule } from './types.js';

const INFO =
    '[군사] 매 턴마다 자신(100%)과 소속 도시 장수(적 포함 50%) 부상 회복<br>[전투] 페이즈마다 40% 확률로 치료 발동(아군 피해 30% 감소, 부상 회복)';

const ATTEMPT_DEDUP_TYPE: Record<string, number> = {
    che_의술_상한잡병론: 301,
    che_의술_정력견혈산: 302,
    che_의술_청낭서: 302,
    che_의술_태평청령: 303,
};

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
    getBattlePhaseTriggerList: (context) => {
        if (!context.unit) {
            return null;
        }
        const attemptRaiseType =
            BaseWarUnitTrigger.TYPE_ITEM + BaseWarUnitTrigger.TYPE_DEDUP_TYPE_BASE * (ATTEMPT_DEDUP_TYPE[key] ?? 0);
        return new WarTriggerCaller(
            new che_의술시도(context.unit, attemptRaiseType),
            new che_의술발동(context.unit, BaseWarUnitTrigger.TYPE_ITEM)
        );
    },
});
