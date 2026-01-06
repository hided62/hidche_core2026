import { GeneralTriggerCaller } from '@sammo-ts/logic/triggers/general.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import { CheUisulCityHealTrigger } from '@sammo-ts/logic/triggers/generalTriggers/che_도시치료.js';
import { triggerModule as cheUisulTriggerModule } from '@sammo-ts/logic/war/triggers/che_의술.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { TraitRequirement, TraitWeightType } from '../requirements.js';

// 전투 특기: 의술
export const traitModule: TraitModule = {
    key: 'che_의술',
    name: '의술',
    info: '[군사] 매 턴마다 자신(100%)과 소속 도시 장수(적 포함 50%) 부상 회복<br>[전투] 페이즈마다 40% 확률로 치료 발동(아군 피해 30% 감소, 부상 회복)',
    kind: 'war',
    getName: () => '의술',
    getInfo: () =>
        '[군사] 매 턴마다 자신(100%)과 소속 도시 장수(적 포함 50%) 부상 회복<br>[전투] 페이즈마다 40% 확률로 치료 발동(아군 피해 30% 감소, 부상 회복)',
    selection: {
        requirements: [TraitRequirement.STAT_LEADERSHIP, TraitRequirement.STAT_STRENGTH, TraitRequirement.STAT_INTEL],
        weight: 2,
        weightType: TraitWeightType.PERCENT,
    },
    getPreTurnExecuteTriggerList: (context) => new GeneralTriggerCaller(new CheUisulCityHealTrigger(context.general)),
    getBattlePhaseTriggerList: (context: WarActionContext) => {
        const unit = context.unit;
        if (!unit) {
            return null;
        }
        return cheUisulTriggerModule.createTriggerList(unit);
    },
};
