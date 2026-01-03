import { GeneralTriggerCaller } from '../../general.js';
import type { WarActionContext } from '../../../war/actions.js';
import { CheUisulCityHealTrigger } from '../../generalTriggers/che_도시치료.js';
import { triggerModule as cheUisulTriggerModule } from '../../../war/triggers/che_의술.js';
import type { SpecialActionModule } from '../types.js';

// 전투 특기: 의술
export const specialModule: SpecialActionModule = {
    key: 'che_의술',
    name: '의술',
    info: '[군사] 매 턴마다 자신(100%)과 소속 도시 장수(적 포함 50%) 부상 회복<br>[전투] 페이즈마다 40% 확률로 치료 발동(아군 피해 30% 감소, 부상 회복)',
    kind: 'war',
    getName: () => '의술',
    getInfo: () =>
        '[군사] 매 턴마다 자신(100%)과 소속 도시 장수(적 포함 50%) 부상 회복<br>[전투] 페이즈마다 40% 확률로 치료 발동(아군 피해 30% 감소, 부상 회복)',
    getPreTurnExecuteTriggerList: (context) =>
        new GeneralTriggerCaller(new CheUisulCityHealTrigger(context.general)),
    getBattlePhaseTriggerList: (context: WarActionContext) => {
        const unit = context.unit;
        if (!unit) {
            return null;
        }
        return cheUisulTriggerModule.createTriggerList(unit);
    },
};
