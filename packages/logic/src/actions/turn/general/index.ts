export type GeneralTurnCommandKey =
    | 'che_상업투자'
    | 'che_화계'
    | 'che_인재탐색'
    | 'che_의병모집'
    | 'che_징병'
    | '휴식';

import type * as CommerceInvestmentModule from './che_상업투자.js';
import type * as FireAttackModule from './che_화계.js';
import type * as TalentScoutModule from './che_인재탐색.js';
import type * as VolunteerRecruitModule from './che_의병모집.js';
import type * as RecruitModule from './che_징병.js';
import type * as RestModule from './휴식.js';

export type GeneralTurnCommandModule =
    | typeof CommerceInvestmentModule
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
    che_상업투자: async () => import('./che_상업투자.js'),
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
    ActionDefinition as CommerceInvestmentActionDefinition,
    ActionResolver as CommerceInvestmentActionResolver,
    CommandResolver as CommerceInvestmentCommandResolver,
} from './che_상업투자.js';
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
