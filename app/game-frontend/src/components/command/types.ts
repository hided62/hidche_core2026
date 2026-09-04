export type CommandOption = {
    value: string | number;
    label: string;
    color?: string;
    description?: string;
    availableNow?: boolean;
    gold?: number;
    rice?: number;
    crew?: number;
    troopId?: number;
    npcState?: number;
};

export type CommandAmountPreset = {
    values: number[];
    defaultValue: number;
    min: number;
    max: number;
    step: number;
};

export type CommandMapData = {
    year: number;
    month: number;
    startYear: number;
    techLevelLimit?: { maxLevel: number; initialLevel: number; increaseYears: number };
    cityList: [number, number, number, number, number, number][];
    nationList: [number, string, string, number][];
    myCity?: number | null;
    myNation?: number | null;
};

export type CommandMapLayout = {
    mapName: string;
    cityList: Array<{ id: number; name: string; level: number; region: number; x: number; y: number; path: number[] }>;
    regionMap: Record<number, string>;
    levelMap: Record<number, string>;
};

export type CommandInputContext = {
    actorGold: number;
    actorRice: number;
    citySecurity?: number;
    nationGold?: number;
    nationRice?: number;
    nationLevel?: number;
};

export type CommandInputField = {
    key: string;
    label: string;
    kind: 'text' | 'number' | 'boolean' | 'select' | 'numberTuple' | 'hidden';
    required: boolean;
    min?: number;
    max?: number;
    legacyWidthMax?: number;
    step?: number;
    defaultValue?: string | number | boolean;
    constValue?: string | number;
    options?: CommandOption[];
    optionSource?: 'cities' | 'nations' | 'generals' | 'crewTypes' | 'armTypes' | 'nationTypes' | 'colors' | 'items';
    tupleLabels?: string[];
};

export type CommandAvailability = {
    key: string;
    name: string;
    turnDurationText?: string;
    costText?: string;
    reqArg: boolean;
    status: 'available' | 'blocked' | 'needsInput' | 'unknown';
    possible: boolean;
    reason?: string;
    inputFields: CommandInputField[];
};

export type CommandGroup = { category: string; values: CommandAvailability[] };

export type RecruitmentCrewType = {
    id: number;
    armType: number;
    name: string;
    available: boolean;
    special: boolean;
    attack: number;
    defence: number;
    speed: number;
    avoid: number;
    baseCost: number;
    baseRice: number;
    info: string[];
};

export type RecruitmentInfo = {
    techLevel: number;
    leadership: number;
    fullLeadership: number;
    currentCrewTypeId: number;
    currentCrewTypeName: string;
    crew: number;
    gold: number;
    groups: Array<{
        armType: number;
        armName: string;
        values: RecruitmentCrewType[];
    }>;
};

export type CommandTable = {
    general: CommandGroup[];
    nation: CommandGroup[];
    inputOptions: {
        cities: CommandOption[];
        nations: CommandOption[];
        nationTargets?: Record<string, CommandOption[]>;
        generals: CommandOption[];
        generalTargets?: Record<string, CommandOption[]>;
        crewTypes: CommandOption[];
        armTypes: CommandOption[];
        nationTypes: CommandOption[];
        colors: CommandOption[];
        items: Record<string, CommandOption[]>;
        recruitment: RecruitmentInfo | null;
        amountPresets?: Record<string, CommandAmountPreset>;
        context?: CommandInputContext;
    };
};

export type ReservedCommandRow = {
    index: number;
    action: string;
    args: unknown;
    label?: string;
    time?: string;
    year?: number;
    month?: number;
    autonomous?: boolean;
};

export type CommandPatternEntry = {
    turnList: number[];
    action: string;
    args: Record<string, unknown>;
    label?: string;
};
