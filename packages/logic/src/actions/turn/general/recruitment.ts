import type {
    General,
    GeneralRole,
    GeneralTriggerState,
    StatBlock,
    TriggerValue,
} from '@sammo-ts/logic/domain/entities.js';

export interface GeneralRecruitmentInput<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    id: number;
    name: string;
    nationId: number;
    cityId: number;
    stats: StatBlock;
    officerLevel: number;
    age: number;
    npcState: number;
    gold: number;
    rice: number;
    experience: number;
    dedication: number;
    crewTypeId: number;
    atmos?: number;
    role: {
        personality: string | null;
        specialDomestic: string | null;
        specialWar: string | null;
    };
    meta?: Record<string, TriggerValue>;
    triggerState?: TriggerState;
}

const createEmptyTriggerState = (): GeneralTriggerState => ({
    flags: {},
    counters: {},
    modifiers: {},
    meta: {},
});

const createEmptyRole = (): GeneralRole => ({
    personality: null,
    specialDomestic: null,
    specialWar: null,
    items: {
        horse: null,
        weapon: null,
        book: null,
        item: null,
    },
});

// 모집/탐색 등으로 생성되는 장수의 기본 모델을 구성한다.
export const buildRecruitmentGeneral = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    input: GeneralRecruitmentInput<TriggerState>
): General<TriggerState> => ({
    id: input.id,
    name: input.name,
    nationId: input.nationId,
    cityId: input.cityId,
    troopId: 0,
    stats: input.stats,
    experience: input.experience,
    dedication: input.dedication,
    officerLevel: input.officerLevel,
    role: {
        ...createEmptyRole(),
        ...input.role,
    },
    injury: 0,
    gold: input.gold,
    rice: input.rice,
    crew: 0,
    crewTypeId: input.crewTypeId,
    train: 0,
    atmos: input.atmos ?? 0,
    age: input.age,
    npcState: input.npcState,
    triggerState: input.triggerState ?? (createEmptyTriggerState() as TriggerState),
    meta: input.meta ?? {},
});
