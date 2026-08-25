import type { UnitSetDefinition, WarEngineConfig } from '@sammo-ts/logic';

export type InheritBuff = {
    warAvoidRatio: number;
    warCriticalRatio: number;
    warMagicTrialProb: number;
    warAvoidRatioOppose: number;
    warCriticalRatioOppose: number;
    warMagicTrialProbOppose: number;
};

export type GeneralDraft = {
    id: string;
    no: number;
    name: string;
    officerLevel: number;
    expLevel: number;
    leadership: number;
    strength: number;
    intel: number;
    horse: string | null;
    weapon: string | null;
    book: string | null;
    item: string | null;
    injury: number;
    rice: number;
    personal: string | null;
    special: string | null;
    special2: string | null;
    crew: number;
    crewtype: number;
    atmos: number;
    train: number;
    dex1: number;
    dex2: number;
    dex3: number;
    dex4: number;
    dex5: number;
    defenceTrain: number;
    warnum: number;
    killnum: number;
    killcrew: number;
    inheritBuff: InheritBuff;
};

export type BattleSimOptions = {
    world: {
        startYear: number;
        currentYear: number;
        currentMonth: number;
    };
    config: WarEngineConfig;
    unitSet: UnitSetDefinition;
    scenarioEffect: string | null;
    defaultSpecialDomestic: string;
    nationTypes: Array<{ key: string; name: string; info: string }>;
    eventDomesticTraits: Array<{ key: string; name: string; info: string }>;
    warTraits: Array<{ key: string; name: string; info: string }>;
    personalities: Array<{ key: string; name: string; info: string }>;
    items: {
        horse: Array<{ key: string; name: string }>;
        weapon: Array<{ key: string; name: string }>;
        book: Array<{ key: string; name: string }>;
        item: Array<{ key: string; name: string }>;
    };
    nationLevels: Array<{ level: number; name: string }>;
    cityLevels: Array<{ level: number; name: string }>;
    dexLevels: Array<{ value: number; color: string; label: string }>;
};
