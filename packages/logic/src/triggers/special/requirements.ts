export enum TraitRequirement {
    DISABLED = 0x1,

    STAT_LEADERSHIP = 0x2,
    STAT_STRENGTH = 0x4,
    STAT_INTEL = 0x8,

    ARMY_FOOTMAN = 0x100,
    ARMY_ARCHER = 0x200,
    ARMY_CAVALRY = 0x400,
    ARMY_WIZARD = 0x800,
    ARMY_SIEGE = 0x1000,

    REQ_DEXTERITY = 0x4000,

    STAT_NOT_LEADERSHIP = 0x20000,
    STAT_NOT_STRENGTH = 0x40000,
    STAT_NOT_INTEL = 0x80000,
}

export enum TraitWeightType {
    NORM = 1,
    PERCENT = 2,
}

export interface TraitSelection {
    weightType: TraitWeightType;
    weight: number;
    requirements: TraitRequirement[];
}
