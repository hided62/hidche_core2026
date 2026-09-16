export type NationPolicy = {
    reqNationGold: number;
    reqNationRice: number;
    CombatForce: Record<number, [number, number]>;
    SupportForce: number[];
    DevelopForce: number[];
    reqHumanWarUrgentGold: number;
    reqHumanWarUrgentRice: number;
    reqHumanWarRecommandGold: number;
    reqHumanWarRecommandRice: number;
    reqHumanDevelGold: number;
    reqHumanDevelRice: number;
    reqNPCWarGold: number;
    reqNPCWarRice: number;
    reqNPCDevelGold: number;
    reqNPCDevelRice: number;
    minimumResourceActionAmount: number;
    maximumResourceActionAmount: number;
    minNPCWarLeadership: number;
    minWarCrew: number;
    minNPCRecruitCityPopulation: number;
    safeRecruitCityPopulationRatio: number;
    properWarTrainAtmos: number;
    cureThreshold: number;
};

export const DEFAULT_NATION_PRIORITY = [
    '불가침제의',
    '선전포고',
    '천도',
    '유저장긴급포상',
    '부대전방발령',
    '유저장구출발령',
    '유저장후방발령',
    '부대유저장후방발령',
    '유저장전방발령',
    '유저장포상',
    '부대구출발령',
    '부대후방발령',
    'NPC긴급포상',
    'NPC구출발령',
    'NPC후방발령',
    'NPC포상',
    'NPC전방발령',
    '유저장내정발령',
    'NPC내정발령',
    'NPC몰수',
] as const;

export const DEFAULT_GENERAL_PRIORITY = [
    'NPC사망대비',
    '귀환',
    '금쌀구매',
    '출병',
    '긴급내정',
    '전투준비',
    '전방워프',
    'NPC헌납',
    '징병',
    '후방워프',
    '전쟁내정',
    '소집해제',
    '일반내정',
    '내정워프',
] as const;

export const DEFAULT_NATION_POLICY: NationPolicy = {
    reqNationGold: 10000,
    reqNationRice: 12000,
    CombatForce: {},
    SupportForce: [],
    DevelopForce: [],
    reqHumanWarUrgentGold: 0,
    reqHumanWarUrgentRice: 0,
    reqHumanWarRecommandGold: 0,
    reqHumanWarRecommandRice: 0,
    reqHumanDevelGold: 10000,
    reqHumanDevelRice: 10000,
    reqNPCWarGold: 0,
    reqNPCWarRice: 0,
    reqNPCDevelGold: 0,
    reqNPCDevelRice: 500,
    minimumResourceActionAmount: 1000,
    maximumResourceActionAmount: 10000,
    minNPCWarLeadership: 40,
    minWarCrew: 1500,
    minNPCRecruitCityPopulation: 50000,
    safeRecruitCityPopulationRatio: 0.5,
    properWarTrainAtmos: 90,
    cureThreshold: 10,
};
