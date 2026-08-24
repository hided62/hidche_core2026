import type { GeneralTurnCommandKey, NationTurnCommandKey } from '@sammo-ts/logic';

export type CommandDurabilityRisk = 'R1' | 'R2' | 'R3';
export type CommandDurabilityScope = 'general' | 'nation';

/**
 * R1 mutates the actor or one aggregate, R2 crosses an actor/aggregate boundary,
 * and R3 can fan out, create/delete entities, fight, or mutate relationships.
 * The typed records deliberately fail compilation when a command is added
 * without an explicit durability classification.
 */
export const generalCommandDurabilityRisk = {
    che_거병: 'R3',
    che_임관: 'R3',
    che_랜덤임관: 'R3',
    che_귀환: 'R1',
    che_등용수락: 'R3',
    che_장수대상임관: 'R3',
    che_건국: 'R3',
    cr_건국: 'R3',
    che_무작위건국: 'R3',
    che_훈련: 'R1',
    cr_맹훈련: 'R1',
    che_전투태세: 'R1',
    che_단련: 'R1',
    che_숙련전환: 'R1',
    che_사기진작: 'R1',
    che_요양: 'R1',
    che_견문: 'R1',
    che_장비매매: 'R2',
    che_내정특기초기화: 'R1',
    che_전투특기초기화: 'R1',
    che_출병: 'R3',
    che_주민선정: 'R2',
    che_정착장려: 'R2',
    che_농지개간: 'R2',
    che_상업투자: 'R2',
    che_기술연구: 'R2',
    che_치안강화: 'R2',
    che_수비강화: 'R2',
    che_성벽보수: 'R2',
    che_화계: 'R3',
    che_집합: 'R3',
    che_인재탐색: 'R3',
    che_징병: 'R2',
    che_모병: 'R2',
    che_소집해제: 'R2',
    che_군량매매: 'R2',
    che_물자조달: 'R2',
    che_헌납: 'R2',
    che_이동: 'R3',
    che_접경귀환: 'R1',
    che_방랑: 'R3',
    che_하야: 'R3',
    che_은퇴: 'R3',
    che_선양: 'R3',
    che_모반시도: 'R3',
    che_증여: 'R3',
    che_해산: 'R3',
    che_등용: 'R3',
    che_첩보: 'R2',
    che_파괴: 'R3',
    che_선동: 'R3',
    che_탈취: 'R3',
    che_NPC능동: 'R1',
    che_강행: 'R3',
    휴식: 'R1',
} as const satisfies Record<GeneralTurnCommandKey, CommandDurabilityRisk>;

export const nationCommandDurabilityRisk = {
    휴식: 'R1',
    che_포상: 'R3',
    che_부대탈퇴지시: 'R3',
    che_발령: 'R3',
    che_선전포고: 'R3',
    che_종전제의: 'R3',
    che_불가침제의: 'R3',
    che_불가침파기제의: 'R3',
    che_의병모집: 'R3',
    che_허보: 'R3',
    che_필사즉생: 'R3',
    che_백성동원: 'R3',
    che_이호경식: 'R3',
    che_수몰: 'R3',
    che_급습: 'R3',
    che_피장파장: 'R3',
    che_초토화: 'R3',
    che_천도: 'R2',
    che_국호변경: 'R1',
    che_무작위수도이전: 'R3',
    che_국기변경: 'R1',
    che_증축: 'R2',
    che_감축: 'R2',
    cr_인구이동: 'R3',
    che_몰수: 'R3',
    che_물자원조: 'R3',
    event_원융노병연구: 'R1',
    event_화시병연구: 'R1',
    event_음귀병연구: 'R1',
    event_대검병연구: 'R1',
    event_화륜차연구: 'R1',
    event_산저병연구: 'R1',
    event_극병연구: 'R1',
    event_상병연구: 'R1',
    event_무희연구: 'R1',
} as const satisfies Record<NationTurnCommandKey, CommandDurabilityRisk>;

export type CommandDurabilityFacet =
    | 'single-actor'
    | 'local-aggregate'
    | 'cross-entity'
    | 'placement-topology'
    | 'hostile-rng-destructive'
    | 'diplomacy-strategy'
    | 'entity-creation-fanout'
    | 'retirement-archive'
    | 'multi-turn-research';

export interface CommandDurabilityEvidence {
    scope: CommandDurabilityScope;
    risk: CommandDurabilityRisk;
    command: GeneralTurnCommandKey | NationTurnCommandKey;
    facet: CommandDurabilityFacet;
    testFile: string;
    matrixRepresentative: boolean;
}

/**
 * This is a representative durable matrix, not a claim that all 90 commands
 * execute against PostgreSQL. Every scope/risk cell runs in the dedicated
 * matrix; high-risk battle, creation, and destructive paths retain their
 * stronger dedicated rollback/reload suites.
 */
export const commandDurabilityEvidence = [
    {
        scope: 'general',
        risk: 'R1',
        command: 'che_훈련',
        facet: 'single-actor',
        testFile: 'turnCommandRiskDurabilityMatrix.integration.test.ts',
        matrixRepresentative: true,
    },
    {
        scope: 'general',
        risk: 'R2',
        command: 'che_농지개간',
        facet: 'local-aggregate',
        testFile: 'turnCommandRiskDurabilityMatrix.integration.test.ts',
        matrixRepresentative: true,
    },
    {
        scope: 'general',
        risk: 'R3',
        command: 'che_증여',
        facet: 'cross-entity',
        testFile: 'turnCommandRiskDurabilityMatrix.integration.test.ts',
        matrixRepresentative: true,
    },
    {
        scope: 'nation',
        risk: 'R1',
        command: 'che_국호변경',
        facet: 'local-aggregate',
        testFile: 'turnCommandRiskDurabilityMatrix.integration.test.ts',
        matrixRepresentative: true,
    },
    {
        scope: 'nation',
        risk: 'R2',
        command: 'che_증축',
        facet: 'local-aggregate',
        testFile: 'turnCommandRiskDurabilityMatrix.integration.test.ts',
        matrixRepresentative: true,
    },
    {
        scope: 'nation',
        risk: 'R3',
        command: 'che_선전포고',
        facet: 'diplomacy-strategy',
        testFile: 'turnCommandRiskDurabilityMatrix.integration.test.ts',
        matrixRepresentative: true,
    },
    {
        scope: 'general',
        risk: 'R3',
        command: 'che_이동',
        facet: 'placement-topology',
        testFile: 'turnCommandRiskDurabilityMatrix.integration.test.ts',
        matrixRepresentative: true,
    },
    {
        scope: 'nation',
        risk: 'R3',
        command: 'che_물자원조',
        facet: 'cross-entity',
        testFile: 'turnCommandRiskDurabilityMatrix.integration.test.ts',
        matrixRepresentative: true,
    },
    {
        scope: 'nation',
        risk: 'R1',
        command: 'event_원융노병연구',
        facet: 'multi-turn-research',
        testFile: 'turnCommandRiskDurabilityMatrix.integration.test.ts',
        matrixRepresentative: true,
    },
    {
        scope: 'general',
        risk: 'R3',
        command: 'che_출병',
        facet: 'hostile-rng-destructive',
        testFile: 'liveSortiePersistence.integration.test.ts',
        matrixRepresentative: false,
    },
    {
        scope: 'nation',
        risk: 'R3',
        command: 'che_의병모집',
        facet: 'entity-creation-fanout',
        testFile: 'turnCommandFullLifecyclePersistence.integration.test.ts',
        matrixRepresentative: false,
    },
    {
        scope: 'general',
        risk: 'R3',
        command: 'che_은퇴',
        facet: 'retirement-archive',
        testFile: 'generalTurnLifecyclePersistence.integration.test.ts',
        matrixRepresentative: false,
    },
] as const satisfies readonly CommandDurabilityEvidence[];
