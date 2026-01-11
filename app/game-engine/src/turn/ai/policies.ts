import type { ScenarioConfig, TurnCommandEnv, UnitSetDefinition } from '@sammo-ts/logic';
import type { TurnGeneral } from '../types.js';
import type { Nation } from '@sammo-ts/logic';
import { findCrewTypeById, getTechCost } from '@sammo-ts/logic/world/unitSet.js';
import { asRecord, readMetaNumber, readNumber, roundTo } from './aiUtils.js';

export type PolicyFlags = Record<string, boolean>;

const DEFAULT_GENERAL_PRIORITY = [
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

const DEFAULT_NATION_PRIORITY = [
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

export const AVAILABLE_INSTANT_TURN: Record<string, boolean> = {
    유저장긴급포상: true,
    유저장구출발령: true,
    유저장후방발령: true,
    유저장전방발령: true,
    유저장내정발령: true,
    유저장포상: true,
    NPC긴급포상: true,
    NPC구출발령: true,
    NPC후방발령: true,
    NPC내정발령: true,
    NPC포상: true,
    NPC전방발령: true,
};

const buildFlags = (entries: Array<[string, boolean]>): PolicyFlags => Object.fromEntries(entries);

const applyPriorityOverride = (priority: string[], override: unknown, flags: PolicyFlags): string[] => {
    if (!Array.isArray(override)) {
        return priority;
    }
    const filtered = override.filter((item) => typeof item === 'string' && flags[item] !== undefined);
    return filtered.length > 0 ? (filtered as string[]) : priority;
};

const resolvePolicyRecord = (raw: unknown): Record<string, unknown> => asRecord(raw);

export class AutorunGeneralPolicy {
    public priority: string[];
    public flags: PolicyFlags;

    constructor(
        general: TurnGeneral,
        aiOptions: Record<string, boolean> | null,
        nationPolicy: Record<string, unknown> | null,
        serverPolicy: Record<string, unknown> | null
    ) {
        this.priority = [...DEFAULT_GENERAL_PRIORITY];
        this.flags = buildFlags([
            ['NPC사망대비', true],
            ['일반내정', true],
            ['긴급내정', true],
            ['전쟁내정', true],
            ['금쌀구매', true],
            ['상인무시', true],
            ['징병', true],
            ['모병', false],
            ['한계징병', false],
            ['고급병종', false],
            ['전투준비', true],
            ['소집해제', true],
            ['출병', true],
            ['NPC헌납', true],
            ['후방워프', true],
            ['전방워프', true],
            ['내정워프', true],
            ['귀환', true],
            ['국가선택', true],
            ['집합', false],
            ['건국', true],
            ['선양', false],
        ]);

        this.priority = applyPriorityOverride(this.priority, serverPolicy?.priority, this.flags);
        this.priority = applyPriorityOverride(this.priority, nationPolicy?.priority, this.flags);

        if (general.npcState >= 2) {
            this.applyNpcState(general);
            return;
        }

        // 유저장 기본값
        this.flags['일반내정'] = false;
        this.flags['긴급내정'] = false;
        this.flags['전쟁내정'] = false;
        this.flags['금쌀구매'] = false;
        this.flags['상인무시'] = false;
        this.flags['징병'] = false;
        this.flags['모병'] = false;
        this.flags['한계징병'] = true;
        this.flags['고급병종'] = true;
        this.flags['전투준비'] = false;
        this.flags['출병'] = false;
        this.flags['NPC헌납'] = false;
        this.flags['후방워프'] = false;
        this.flags['전방워프'] = false;
        this.flags['내정워프'] = false;
        this.flags['국가선택'] = false;
        this.flags['집합'] = false;
        this.flags['건국'] = false;
        this.flags['선양'] = false;

        const options = aiOptions ?? {};
        for (const [key, enabled] of Object.entries(options)) {
            if (!enabled) {
                continue;
            }
            switch (key) {
                case 'develop':
                    this.flags['일반내정'] = true;
                    this.flags['전쟁내정'] = true;
                    this.flags['금쌀구매'] = true;
                    break;
                case 'warp':
                    this.flags['후방워프'] = true;
                    this.flags['전방워프'] = true;
                    this.flags['내정워프'] = true;
                    this.flags['금쌀구매'] = true;
                    this.flags['상인무시'] = true;
                    break;
                case 'recruit_high': {
                    this.flags['모병'] = true;
                    this.flags['징병'] = true;
                    this.flags['소집해제'] = true;
                    this.flags['금쌀구매'] = true;
                    break;
                }
                case 'recruit':
                    this.flags['징병'] = true;
                    this.flags['소집해제'] = true;
                    this.flags['금쌀구매'] = true;
                    break;
                case 'train':
                    this.flags['전투준비'] = true;
                    this.flags['금쌀구매'] = true;
                    break;
                case 'battle':
                    this.flags['출병'] = true;
                    this.flags['금쌀구매'] = true;
                    break;
                default:
                    break;
            }
        }
    }

    can(actionName: string): boolean {
        return this.flags[actionName] ?? false;
    }

    private applyNpcState(general: TurnGeneral): void {
        if (general.npcState === 5) {
            this.flags['집합'] = true;
            this.flags['선양'] = true;
            this.flags['국가선택'] = false;
            return;
        }
        if (general.npcState === 1) {
            this.flags['NPC사망대비'] = false;
        }
        if (general.nationId !== 0) {
            this.flags['국가선택'] = false;
            this.flags['건국'] = false;
        }
    }
}

export class AutorunNationPolicy {
    public priority: string[];
    public flags: PolicyFlags;

    public reqNationGold = 10000;
    public reqNationRice = 12000;
    public combatForce: Record<number, [number, number]> = {};
    public supportForce: number[] = [];
    public developForce: number[] = [];
    public reqHumanWarUrgentGold = 0;
    public reqHumanWarUrgentRice = 0;
    public reqHumanWarRecommandGold = 0;
    public reqHumanWarRecommandRice = 0;
    public reqHumanDevelGold = 10000;
    public reqHumanDevelRice = 10000;
    public reqNpcWarGold = 0;
    public reqNpcWarRice = 0;
    public reqNpcDevelGold = 0;
    public reqNpcDevelRice = 500;
    public minimumResourceActionAmount = 1000;
    public maximumResourceActionAmount = 10000;
    public minNpcWarLeadership = 40;
    public minWarCrew = 1500;
    public minNpcRecruitCityPopulation = 50000;
    public safeRecruitCityPopulationRatio = 0.5;
    public properWarTrainAtmos = 90;
    public cureThreshold = 10;

    constructor(options: {
        general: TurnGeneral;
        aiOptions: Record<string, boolean> | null;
        nationPolicy: Record<string, unknown> | null;
        serverPolicy: Record<string, unknown> | null;
        nation: Nation;
        env: TurnCommandEnv;
        scenarioConfig: ScenarioConfig;
        unitSet?: UnitSetDefinition;
    }) {
        const { general, aiOptions, nationPolicy, serverPolicy, env, scenarioConfig, unitSet, nation } = options;

        this.priority = [...DEFAULT_NATION_PRIORITY];
        this.flags = buildFlags(DEFAULT_NATION_PRIORITY.map((key) => [key, true]));
        this.flags['부대구출발령'] = true;
        this.flags['부대후방발령'] = true;
        this.flags['부대전방발령'] = true;
        this.flags['NPC몰수'] = true;
        this.flags['부대유저장후방발령'] = true;

        const serverValues = resolvePolicyRecord(serverPolicy?.values);
        for (const [key, value] of Object.entries(serverValues)) {
            this.applyValueOverride(key, value);
        }
        if (serverPolicy?.priority) {
            this.priority = applyPriorityOverride(this.priority, serverPolicy.priority, this.flags);
        }

        const nationValues = resolvePolicyRecord(nationPolicy?.values);
        for (const [key, value] of Object.entries(nationValues)) {
            this.applyValueOverride(key, value);
        }
        if (nationPolicy?.priority) {
            this.priority = applyPriorityOverride(this.priority, nationPolicy.priority, this.flags);
        }

        if (this.priority.length === 0) {
            this.priority = [...DEFAULT_NATION_PRIORITY];
        }

        if (this.reqNpcDevelGold === 0) {
            this.reqNpcDevelGold = env.develCost * 30;
        }

        const tech = readMetaNumber(asRecord(nation.meta), 'tech', 0);
        const stat = scenarioConfig.stat;
        if (this.reqNpcWarGold === 0 || this.reqNpcWarRice === 0) {
            const crewType = findCrewTypeById(unitSet, env.defaultCrewTypeId);
            const baseGold = crewType ? crewType.cost * getTechCost(tech) * stat.npcMax : 0;
            const baseRice = stat.npcMax;
            if (this.reqNpcWarGold === 0) {
                this.reqNpcWarGold = roundTo(baseGold * 4, -2);
            }
            if (this.reqNpcWarRice === 0) {
                this.reqNpcWarRice = roundTo(baseRice * 4, -2);
            }
        }

        if (this.reqHumanWarUrgentGold === 0 || this.reqHumanWarUrgentRice === 0) {
            const crewType = findCrewTypeById(unitSet, env.defaultCrewTypeId);
            const baseGold = crewType ? crewType.cost * getTechCost(tech) * stat.max : 0;
            const baseRice = stat.max;
            if (this.reqHumanWarUrgentGold === 0) {
                this.reqHumanWarUrgentGold = roundTo(baseGold * 6, -2);
            }
            if (this.reqHumanWarUrgentRice === 0) {
                this.reqHumanWarUrgentRice = roundTo(baseRice * 6, -2);
            }
        }

        if (this.reqHumanWarRecommandGold === 0) {
            this.reqHumanWarRecommandGold = roundTo(this.reqHumanWarUrgentGold * 2, -2);
        }
        if (this.reqHumanWarRecommandRice === 0) {
            this.reqHumanWarRecommandRice = roundTo(this.reqHumanWarUrgentRice * 2, -2);
        }

        if (general.npcState >= 2) {
            return;
        }

        if (!aiOptions?.chief) {
            for (const key of Object.keys(this.flags)) {
                this.flags[key] = false;
            }
            this.flags['선전포고'] = false;
            this.flags['천도'] = false;
        }
    }

    can(actionName: string): boolean {
        return this.flags[actionName] ?? false;
    }

    private applyValueOverride(key: string, value: unknown): void {
        switch (key) {
            case 'reqNationGold':
                this.reqNationGold = readNumber(value, this.reqNationGold);
                return;
            case 'reqNationRice':
                this.reqNationRice = readNumber(value, this.reqNationRice);
                return;
            case 'CombatForce':
                if (value && typeof value === 'object') {
                    const record = value as Record<string, unknown>;
                    const next: Record<number, [number, number]> = {};
                    for (const [rawKey, rawValue] of Object.entries(record)) {
                        const leaderId = Number(rawKey);
                        if (!Number.isFinite(leaderId)) {
                            continue;
                        }
                        if (!Array.isArray(rawValue) || rawValue.length < 2) {
                            continue;
                        }
                        const fromCity = Number(rawValue[0]);
                        const toCity = Number(rawValue[1]);
                        if (!Number.isFinite(fromCity) || !Number.isFinite(toCity)) {
                            continue;
                        }
                        next[leaderId] = [fromCity, toCity];
                    }
                    this.combatForce = next;
                }
                return;
            case 'SupportForce':
                if (Array.isArray(value)) {
                    this.supportForce = value.filter((v) => typeof v === 'number') as number[];
                }
                return;
            case 'DevelopForce':
                if (Array.isArray(value)) {
                    this.developForce = value.filter((v) => typeof v === 'number') as number[];
                }
                return;
            case 'reqHumanWarUrgentGold':
                this.reqHumanWarUrgentGold = readNumber(value, this.reqHumanWarUrgentGold);
                return;
            case 'reqHumanWarUrgentRice':
                this.reqHumanWarUrgentRice = readNumber(value, this.reqHumanWarUrgentRice);
                return;
            case 'reqHumanWarRecommandGold':
                this.reqHumanWarRecommandGold = readNumber(value, this.reqHumanWarRecommandGold);
                return;
            case 'reqHumanWarRecommandRice':
                this.reqHumanWarRecommandRice = readNumber(value, this.reqHumanWarRecommandRice);
                return;
            case 'reqHumanDevelGold':
                this.reqHumanDevelGold = readNumber(value, this.reqHumanDevelGold);
                return;
            case 'reqHumanDevelRice':
                this.reqHumanDevelRice = readNumber(value, this.reqHumanDevelRice);
                return;
            case 'reqNPCWarGold':
                this.reqNpcWarGold = readNumber(value, this.reqNpcWarGold);
                return;
            case 'reqNPCWarRice':
                this.reqNpcWarRice = readNumber(value, this.reqNpcWarRice);
                return;
            case 'reqNPCDevelGold':
                this.reqNpcDevelGold = readNumber(value, this.reqNpcDevelGold);
                return;
            case 'reqNPCDevelRice':
                this.reqNpcDevelRice = readNumber(value, this.reqNpcDevelRice);
                return;
            case 'minimumResourceActionAmount':
                this.minimumResourceActionAmount = readNumber(value, this.minimumResourceActionAmount);
                return;
            case 'maximumResourceActionAmount':
                this.maximumResourceActionAmount = readNumber(value, this.maximumResourceActionAmount);
                return;
            case 'minNPCWarLeadership':
                this.minNpcWarLeadership = readNumber(value, this.minNpcWarLeadership);
                return;
            case 'minWarCrew':
                this.minWarCrew = readNumber(value, this.minWarCrew);
                return;
            case 'minNPCRecruitCityPopulation':
                this.minNpcRecruitCityPopulation = readNumber(value, this.minNpcRecruitCityPopulation);
                return;
            case 'safeRecruitCityPopulationRatio':
                this.safeRecruitCityPopulationRatio = readNumber(value, this.safeRecruitCityPopulationRatio);
                return;
            case 'properWarTrainAtmos':
                this.properWarTrainAtmos = readNumber(value, this.properWarTrainAtmos);
                return;
            case 'cureThreshold':
                this.cureThreshold = readNumber(value, this.cureThreshold);
                return;
            default:
                return;
        }
    }
}
