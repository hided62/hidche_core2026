export interface ScenarioStatBlock {
    total: number;
    min: number;
    max: number;
    npcTotal: number;
    npcMax: number;
    npcMin: number;
    chiefMin: number;
}

export interface ScenarioDefaults {
    stat: ScenarioStatBlock;
    iconPath: string;
}

export interface ScenarioEnvironment {
    mapName: string;
    unitSet: string;
    scenarioEffect?: string | null;
}

export interface ScenarioConfig {
    stat: ScenarioStatBlock;
    iconPath: string;
    map: Record<string, unknown>;
    const: Record<string, unknown>;
    environment: ScenarioEnvironment;
}

export interface ScenarioNation {
    id: number;
    name: string;
    color: string;
    gold: number;
    rice: number;
    infoText: string | null;
    tech: number;
    type: string;
    level: number;
    cities: string[];
}

export interface ScenarioDiplomacy {
    fromNationId: number;
    toNationId: number;
    state: number;
    durationMonths: number;
}

export interface ScenarioGeneral {
    affinity: number | null;
    name: string;
    picture: number | string | null;
    nation: number | string | null;
    city: string | null;
    leadership: number;
    strength: number;
    intelligence: number;
    officerLevel: number;
    birthYear: number;
    deathYear: number;
    personality: string | null;
    special: string | null;
    specialWar?: string | null;
    horse?: string | null;
    weapon?: string | null;
    book?: string | null;
    item?: string | null;
    text: string | null;
}

export interface ScenarioDefinition {
    title: string;
    startYear: number | null;
    life: number | null;
    fiction: number | null;
    history: string[];
    config: ScenarioConfig;
    nations: ScenarioNation[];
    diplomacy: ScenarioDiplomacy[];
    generals: ScenarioGeneral[];
    generalsEx: ScenarioGeneral[];
    generalsNeutral: ScenarioGeneral[];
    cities: unknown[];
    events: unknown[];
    initialEvents: unknown[];
    ignoreDefaultEvents: boolean;
}
