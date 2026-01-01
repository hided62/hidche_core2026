export type GeneralTurnCommandKey =
    | 'che_거병'
    | 'che_임관'
    | 'che_건국'
    | 'che_훈련'
    | 'che_사기진작'
    | 'che_요양'
    | 'che_출병'
    | 'che_주민선정'
    | 'che_농지개간'
    | 'che_상업투자'
    | 'che_기술연구'
    | 'che_치안강화'
    | 'che_수비강화'
    | 'che_성벽보수'
    | 'che_화계'
    | 'che_인재탐색'
    | 'che_의병모집'
    | 'che_징병'
    | '휴식';

import type * as UprisingModule from './che_거병.js';
import type * as AppointmentModule from './che_임관.js';
import type * as FoundingModule from './che_건국.js';
import type * as TrainingModule from './che_훈련.js';
import type * as BoostMoraleModule from './che_사기진작.js';
import type * as RecoveryModule from './che_요양.js';
import type * as DispatchModule from './che_출병.js';
import type * as ResidentsSelectionModule from './che_주민선정.js';
import type * as FarmingModule from './che_농지개간.js';
import type * as CommerceInvestmentModule from './che_상업투자.js';
import type * as TechResearchModule from './che_기술연구.js';
import type * as SecurityUpgradeModule from './che_치안강화.js';
import type * as DefenceUpgradeModule from './che_수비강화.js';
import type * as WallRepairModule from './che_성벽보수.js';
import type * as FireAttackModule from './che_화계.js';
import type * as TalentScoutModule from './che_인재탐색.js';
import type * as VolunteerRecruitModule from './che_의병모집.js';
import type * as RecruitModule from './che_징병.js';
import type * as RestModule from './휴식.js';

export type GeneralTurnCommandModule =
    | typeof UprisingModule
    | typeof AppointmentModule
    | typeof FoundingModule
    | typeof TrainingModule
    | typeof BoostMoraleModule
    | typeof RecoveryModule
    | typeof DispatchModule
    | typeof ResidentsSelectionModule
    | typeof FarmingModule
    | typeof CommerceInvestmentModule
    | typeof TechResearchModule
    | typeof SecurityUpgradeModule
    | typeof DefenceUpgradeModule
    | typeof WallRepairModule
    | typeof FireAttackModule
    | typeof TalentScoutModule
    | typeof VolunteerRecruitModule
    | typeof RecruitModule
    | typeof RestModule;

export type GeneralTurnCommandImporter = () => Promise<GeneralTurnCommandModule>;

const defaultImporters: Record<
    GeneralTurnCommandKey,
    GeneralTurnCommandImporter
> = {
    che_거병: async () => import('./che_거병.js'),
    che_임관: async () => import('./che_임관.js'),
    che_건국: async () => import('./che_건국.js'),
    che_훈련: async () => import('./che_훈련.js'),
    che_사기진작: async () => import('./che_사기진작.js'),
    che_요양: async () => import('./che_요양.js'),
    che_출병: async () => import('./che_출병.js'),
    che_주민선정: async () => import('./che_주민선정.js'),
    che_농지개간: async () => import('./che_농지개간.js'),
    che_상업투자: async () => import('./che_상업투자.js'),
    che_기술연구: async () => import('./che_기술연구.js'),
    che_치안강화: async () => import('./che_치안강화.js'),
    che_수비강화: async () => import('./che_수비강화.js'),
    che_성벽보수: async () => import('./che_성벽보수.js'),
    che_화계: async () => import('./che_화계.js'),
    che_인재탐색: async () => import('./che_인재탐색.js'),
    che_의병모집: async () => import('./che_의병모집.js'),
    che_징병: async () => import('./che_징병.js'),
    휴식: async () => import('./휴식.js'),
};

export class GeneralTurnCommandLoader {
    constructor(
        private readonly importers: Record<
            GeneralTurnCommandKey,
            GeneralTurnCommandImporter
        > = defaultImporters
    ) {}

    async load(
        key: GeneralTurnCommandKey
    ): Promise<GeneralTurnCommandModule> {
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown general turn command key: ${key}`);
        }
        return importer();
    }
}

export {
    ActionDefinition as UprisingActionDefinition,
} from './che_거병.js';
export {
    ActionDefinition as AppointmentActionDefinition,
} from './che_임관.js';
export {
    ActionDefinition as FoundingActionDefinition,
} from './che_건국.js';
export {
    ActionDefinition as TrainingActionDefinition,
} from './che_훈련.js';
export {
    ActionDefinition as BoostMoraleActionDefinition,
} from './che_사기진작.js';
export {
    ActionDefinition as RecoveryActionDefinition,
} from './che_요양.js';
export {
    ActionDefinition as DispatchActionDefinition,
} from './che_출병.js';
export {
    ActionDefinition as ResidentsSelectionActionDefinition,
} from './che_주민선정.js';
export {
    ActionDefinition as FarmingActionDefinition,
} from './che_농지개간.js';
export {
    ActionDefinition as CommerceInvestmentActionDefinition,
    ActionResolver as CommerceInvestmentActionResolver,
    CommandResolver as CommerceInvestmentCommandResolver,
} from './che_상업투자.js';
export {
    ActionDefinition as TechResearchActionDefinition,
} from './che_기술연구.js';
export {
    ActionDefinition as SecurityUpgradeActionDefinition,
} from './che_치안강화.js';
export {
    ActionDefinition as DefenceUpgradeActionDefinition,
} from './che_수비강화.js';
export {
    ActionDefinition as WallRepairActionDefinition,
} from './che_성벽보수.js';
export {
    ActionDefinition as FireAttackActionDefinition,
    ActionResolver as FireAttackActionResolver,
    CommandResolver as FireAttackCommandResolver,
} from './che_화계.js';
export {
    ActionDefinition as TalentScoutActionDefinition,
    ActionResolver as TalentScoutActionResolver,
    CommandResolver as TalentScoutCommandResolver,
} from './che_인재탐색.js';
export {
    ActionDefinition as VolunteerRecruitActionDefinition,
    ActionResolver as VolunteerRecruitActionResolver,
    CommandResolver as VolunteerRecruitCommandResolver,
} from './che_의병모집.js';
export {
    ActionDefinition as RecruitActionDefinition,
    ActionResolver as RecruitActionResolver,
    CommandResolver as RecruitCommandResolver,
} from './che_징병.js';
export {
    ActionDefinition as RestActionDefinition,
    ActionResolver as RestActionResolver,
} from './휴식.js';
