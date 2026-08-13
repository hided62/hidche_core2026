export type CommandOption = { value: string | number; label: string; color?: string };

export type CommandInputField = {
    key: string;
    label: string;
    kind: 'text' | 'number' | 'boolean' | 'select' | 'numberTuple' | 'hidden';
    required: boolean;
    min?: number;
    max?: number;
    step?: number;
    constValue?: string | number;
    options?: CommandOption[];
    optionSource?: 'cities' | 'nations' | 'generals' | 'crewTypes' | 'armTypes' | 'nationTypes' | 'colors' | 'items';
    tupleLabels?: string[];
};

export type CommandAvailability = {
    key: string;
    name: string;
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
        generals: CommandOption[];
        crewTypes: CommandOption[];
        armTypes: CommandOption[];
        nationTypes: CommandOption[];
        colors: CommandOption[];
        items: Record<string, CommandOption[]>;
        recruitment: RecruitmentInfo | null;
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
