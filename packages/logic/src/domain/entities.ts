// 도메인 기본 엔티티: 서비스/DB에 의존하지 않는 공통 모델.

export type GeneralId = number;
export type CityId = number;
export type NationId = number;
export type TroopId = number;

export type ColorCode = string;

export interface StatBlock {
    leadership: number;
    strength: number;
    intelligence: number;
}

export type TriggerValue = boolean | number | string;

export interface GeneralTriggerState {
    // Trigger 시스템에서 사용하는 확장 슬롯.
    flags: Record<string, boolean>;
    counters: Record<string, number>;
    modifiers: Record<string, number>;
    meta: Record<string, TriggerValue>;
}

export interface GeneralItemSlots {
    horse: string | null;
    weapon: string | null;
    book: string | null;
    item: string | null;
}

export interface GeneralRole {
    // General.php의 raw 컬럼을 그대로 유지하는 역할 데이터.
    personality: string | null;
    specialDomestic: string | null;
    specialWar: string | null;
    items: GeneralItemSlots;
}

export interface General<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    id: GeneralId;
    name: string;
    nationId: NationId;
    cityId: CityId;
    troopId: number;
    stats: StatBlock;
    experience: number;
    dedication: number;
    officerLevel: number;
    role: GeneralRole;
    injury: number;
    gold: number;
    rice: number;
    crew: number;
    crewTypeId: number;
    train: number;
    atmos: number;
    age: number;
    npcState: number;
    triggerState: TriggerState;
    meta: Record<string, TriggerValue>;
}

export interface City {
    id: CityId;
    name: string;
    nationId: NationId;
    level: number;
    state: number;
    population: number;
    populationMax: number;
    agriculture: number;
    agricultureMax: number;
    commerce: number;
    commerceMax: number;
    security: number;
    securityMax: number;
    supplyState: number;
    frontState: number;
    defence: number;
    defenceMax: number;
    wall: number;
    wallMax: number;
    meta: Record<string, TriggerValue>;
}

export interface Nation {
    id: NationId;
    name: string;
    color: ColorCode;
    capitalCityId: CityId | null;
    chiefGeneralId: GeneralId | null;
    gold: number;
    rice: number;
    power: number;
    level: number;
    typeCode: string;
    meta: Record<string, TriggerValue>;
}

export interface Troop {
    id: TroopId;
    nationId: NationId;
    name: string;
}
