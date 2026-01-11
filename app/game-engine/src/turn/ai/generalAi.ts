import type {
    City,
    GeneralActionDefinition,
    MapDefinition,
    Nation,
    ScenarioConfig,
    ScenarioMeta,
    TurnCommandEnv,
    UnitSetDefinition,
} from '@sammo-ts/logic';
import { evaluateConstraints } from '@sammo-ts/logic';
import type { ConstraintContext, StateView } from '@sammo-ts/logic';
import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';
import { resolveStartYear, resolveTurnTermMinutes } from '@sammo-ts/logic/actions/turn/actionContextHelpers.js';

import type { ReservedTurnEntry } from '../reservedTurnStore.js';
import type { TurnGeneral, TurnWorldState } from '../types.js';
import type { AiCommandCandidate, AiReservedTurnProvider, AiWorldView } from './types.js';
import { AutorunGeneralPolicy, AutorunNationPolicy, AVAILABLE_INSTANT_TURN } from './policies.js';
import { asRecord, joinYearMonth, readMetaNumber, readNumber, roundTo, valueFit } from './aiUtils.js';
import { searchAllDistanceByNationList } from './distance.js';
import { generalActionHandlers } from './generalAiGeneralActions.js';
import { nationActionHandlers } from './generalAiNationActions.js';

const ACTION_REST = '휴식';

const t무장 = 1;
const t지장 = 2;
const t통솔장 = 4;

const d평화 = 0;
const d선포 = 1;
const d징병 = 2;
const d직전 = 3;
const d전쟁 = 4;

type ConstraintEnv = Record<string, unknown>;

const resolveConstraintEnv = (
    world: TurnWorldState,
    scenarioMeta: ScenarioMeta | undefined,
    env: TurnCommandEnv
): ConstraintEnv => {
    const startYear = typeof scenarioMeta?.startYear === 'number' ? scenarioMeta.startYear : undefined;
    const relYear = typeof startYear === 'number' ? world.currentYear - startYear : undefined;

    return {
        currentYear: world.currentYear,
        currentMonth: world.currentMonth,
        year: world.currentYear,
        month: world.currentMonth,
        startYear,
        relYear,
        openingPartYear: env.openingPartYear,
    };
};

const buildSeedBase = (world: TurnWorldState): string => {
    const meta = asRecord(world.meta);
    const rawSeed = meta.hiddenSeed ?? meta.seed ?? world.id;
    return String(rawSeed);
};

class WorldStateView implements StateView {
    constructor(
        private readonly world: AiWorldView | null,
        private readonly env: ConstraintEnv,
        private readonly args: Record<string, unknown>,
        private readonly overrides?: {
            general?: TurnGeneral;
            city?: City;
            nation?: Nation | null;
        }
    ) {}

    has(req: Parameters<StateView['has']>[0]): boolean {
        return this.get(req) !== null;
    }

    get(req: Parameters<StateView['get']>[0]): unknown | null {
        if (!this.world) {
            return null;
        }
        switch (req.kind) {
            case 'general':
                if (this.overrides?.general && this.overrides.general.id === req.id) {
                    return this.overrides.general;
                }
                return this.world.getGeneralById(req.id);
            case 'generalList':
                return this.world.listGenerals();
            case 'destGeneral':
                return this.world.getGeneralById(req.id);
            case 'city':
                if (this.overrides?.city && this.overrides.city.id === req.id) {
                    return this.overrides.city;
                }
                return this.world.getCityById(req.id);
            case 'destCity':
                return this.world.getCityById(req.id);
            case 'nation':
                if (this.overrides?.nation && this.overrides.nation.id === req.id) {
                    return this.overrides.nation;
                }
                return this.world.getNationById(req.id);
            case 'nationList':
                return this.world.listNations();
            case 'destNation':
                return this.world.getNationById(req.id);
            case 'diplomacy':
                return this.world.getDiplomacyEntry(req.srcNationId, req.destNationId);
            case 'diplomacyList':
                return this.world.listDiplomacy();
            case 'arg':
                return this.args[req.key] ?? null;
            case 'env':
                return this.env[req.key] ?? null;
            default:
                return null;
        }
    }
}

export interface GeneralAIOptions {
    general: TurnGeneral;
    city?: City;
    nation?: Nation | null;
    world: TurnWorldState;
    worldRef: AiWorldView | null;
    reservedTurnProvider: AiReservedTurnProvider;
    scenarioConfig: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    map?: MapDefinition;
    unitSet?: UnitSetDefinition;
    commandEnv: TurnCommandEnv;
    generalDefinitions: Map<string, GeneralActionDefinition>;
    nationDefinitions: Map<string, GeneralActionDefinition>;
    generalFallback: GeneralActionDefinition;
    nationFallback: GeneralActionDefinition;
}

export class GeneralAI {
    public readonly general: TurnGeneral;
    public readonly city?: City;
    public readonly nation?: Nation | null;
    public readonly world: TurnWorldState;
    public readonly worldRef: AiWorldView | null;
    public readonly map?: MapDefinition;
    public readonly unitSet?: UnitSetDefinition;
    public readonly commandEnv: TurnCommandEnv;
    public readonly scenarioConfig: ScenarioConfig;
    public readonly scenarioMeta?: ScenarioMeta;

    public readonly generalDefinitions: Map<string, GeneralActionDefinition>;
    public readonly nationDefinitions: Map<string, GeneralActionDefinition>;
    public readonly generalFallback: GeneralActionDefinition;
    public readonly nationFallback: GeneralActionDefinition;

    public readonly rng: RandUtil;
    public readonly env: ConstraintEnv;
    public readonly startYear: number;
    public readonly turnTermMinutes: number;

    public readonly aiConst: {
        baseGold: number;
        baseRice: number;
        minAvailableRecruitPop: number;
        maxResourceActionAmount: number;
        minNationalGold: number;
        minNationalRice: number;
        defaultStatMax: number;
        defaultStatNpcMax: number;
        chiefStatMin: number;
        npcMessageFreqByDay: number;
        availableNationTypes: string[];
    };

    public generalPolicy: AutorunGeneralPolicy;
    public nationPolicy: AutorunNationPolicy;

    public genType = 0;
    public dipState = d평화;
    public warTargetNation: Record<number, number> = {};
    public attackable = false;
    public maxResourceActionAmount = 0;

    public nationCities: Record<
        number,
        City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
    > = {};
    public frontCities: Record<
        number,
        City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
    > = {};
    public supplyCities: Record<
        number,
        City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
    > = {};
    public backupCities: Record<
        number,
        City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
    > = {};
    public warRoute: Record<number, Record<number, number>> | null = null;

    public nationGenerals: TurnGeneral[] = [];
    public npcCivilGenerals: Record<number, TurnGeneral> = {};
    public npcWarGenerals: Record<number, TurnGeneral> = {};
    public userGenerals: Record<number, TurnGeneral> = {};
    public userWarGenerals: Record<number, TurnGeneral> = {};
    public userCivilGenerals: Record<number, TurnGeneral> = {};
    public chiefGenerals: Record<number, TurnGeneral> = {};
    public lostGenerals: Record<number, TurnGeneral> = {};
    public troopLeaders: Record<number, TurnGeneral> = {};

    private reqUpdateInstance = true;
    private devRate: Record<string, number> | null = null;
    private categorizedCities = false;
    private categorizedGenerals = false;

    private readonly reservedTurnProvider: AiReservedTurnProvider;

    constructor(options: GeneralAIOptions) {
        this.general = options.general;
        this.city = options.city;
        this.nation = options.nation ?? null;
        this.world = options.world;
        this.worldRef = options.worldRef;
        this.map = options.map;
        this.unitSet = options.unitSet;
        this.commandEnv = options.commandEnv;
        this.scenarioConfig = options.scenarioConfig;
        this.scenarioMeta = options.scenarioMeta;
        this.reservedTurnProvider = options.reservedTurnProvider;

        this.generalDefinitions = options.generalDefinitions;
        this.nationDefinitions = options.nationDefinitions;
        this.generalFallback = options.generalFallback;
        this.nationFallback = options.nationFallback;

        this.startYear = resolveStartYear(this.world, this.scenarioMeta);
        this.turnTermMinutes = resolveTurnTermMinutes(this.world);
        this.env = resolveConstraintEnv(this.world, this.scenarioMeta, this.commandEnv);

        const seed = simpleSerialize(
            buildSeedBase(this.world),
            'GeneralAI',
            this.world.currentYear,
            this.world.currentMonth,
            this.general.id
        );
        this.rng = new RandUtil(LiteHashDRBG.build(seed));

        const constValues = asRecord(this.scenarioConfig.const);
        this.aiConst = {
            baseGold: this.commandEnv.baseGold,
            baseRice: this.commandEnv.baseRice,
            minAvailableRecruitPop: readNumber(constValues.minAvailableRecruitPop, 30000),
            maxResourceActionAmount: this.commandEnv.maxResourceActionAmount || 10000,
            minNationalGold: readNumber(constValues.minNationalGold, this.commandEnv.baseGold),
            minNationalRice: readNumber(constValues.minNationalRice, this.commandEnv.baseRice),
            defaultStatMax: this.scenarioConfig.stat.max,
            defaultStatNpcMax: this.scenarioConfig.stat.npcMax,
            chiefStatMin: this.scenarioConfig.stat.chiefMin,
            npcMessageFreqByDay: readNumber(constValues.npcMessageFreqByDay, 0),
            availableNationTypes: Array.isArray(constValues.availableNationType)
                ? constValues.availableNationType.filter((value) => typeof value === 'string')
                : [],
        };

        const generalPolicy = new AutorunGeneralPolicy(
            this.general,
            asRecord((this.world.meta as Record<string, unknown>)?.autorun_user)?.options as Record<string, boolean>,
            asRecord(this.nation?.meta)?.npc_general_policy as Record<string, unknown> | null,
            asRecord(this.world.meta)?.npc_general_policy as Record<string, unknown> | null
        );
        const nationPolicy = new AutorunNationPolicy({
            general: this.general,
            aiOptions: asRecord((this.world.meta as Record<string, unknown>)?.autorun_user)?.options as Record<
                string,
                boolean
            > | null,
            nationPolicy: asRecord(this.nation?.meta)?.npc_nation_policy as Record<string, unknown> | null,
            serverPolicy: asRecord(this.world.meta)?.npc_nation_policy as Record<string, unknown> | null,
            nation: this.nation ?? {
                id: 0,
                name: '재야',
                color: '#000000',
                capitalCityId: null,
                chiefGeneralId: null,
                gold: 0,
                rice: 0,
                power: 0,
                level: 0,
                typeCode: 'neutral',
                meta: {},
            },
            env: this.commandEnv,
            scenarioConfig: this.scenarioConfig,
            unitSet: this.unitSet,
        });

        this.generalPolicy = generalPolicy;
        this.nationPolicy = nationPolicy;
    }

    chooseNationTurn(reservedTurn: ReservedTurnEntry): AiCommandCandidate | null {
        this.updateInstance();
        if (!this.nation || !this.worldRef) {
            return null;
        }
        this.categorizeNationCities();
        this.categorizeNationGeneral();

        if (reservedTurn.action !== ACTION_REST) {
            const reservedCandidate = this.buildNationCandidate(reservedTurn.action, reservedTurn.args, 'reserved');
            if (reservedCandidate) {
                return reservedCandidate;
            }
        }

        for (const actionName of this.nationPolicy.priority) {
            if (!this.nationPolicy.can(actionName)) {
                continue;
            }
            if (this.general.npcState < 2 && !AVAILABLE_INSTANT_TURN[actionName]) {
                continue;
            }
            const handler = nationActionHandlers[actionName];
            if (!handler) {
                continue;
            }
            const result = handler(this);
            if (result) {
                return result;
            }
        }

        return this.buildNationCandidate(ACTION_REST, {}, 'neutral');
    }

    chooseGeneralTurn(reservedTurn: ReservedTurnEntry): AiCommandCandidate | null {
        this.updateInstance();
        if (!this.worldRef) {
            return null;
        }

        if (this.general.npcState === 5) {
            const result = generalActionHandlers['집합']?.(this);
            return result ?? this.buildGeneralCandidate(ACTION_REST, {}, 'npc_troop');
        }

        if (reservedTurn.action !== ACTION_REST) {
            const reservedCandidate = this.buildGeneralCandidate(reservedTurn.action, reservedTurn.args, 'reserved');
            if (reservedCandidate) {
                return reservedCandidate;
            }
        }

        if (
            readMetaNumber(asRecord(this.general.meta), 'injury', this.general.injury) > this.nationPolicy.cureThreshold
        ) {
            const heal = this.buildGeneralCandidate('che_요양', {}, 'heal');
            if (heal) {
                return heal;
            }
        }

        if ([2, 3].includes(this.general.npcState) && this.general.nationId === 0) {
            const rebellion = generalActionHandlers['거병']?.(this);
            if (rebellion) {
                return rebellion;
            }
        }

        if (this.general.nationId === 0 && this.generalPolicy.can('국가선택')) {
            const pickNation = generalActionHandlers['국가선택']?.(this);
            if (pickNation) {
                return pickNation;
            }
            const neutral = generalActionHandlers['중립']?.(this);
            return neutral ?? this.buildGeneralCandidate(ACTION_REST, {}, 'neutral');
        }

        if (this.general.npcState < 2 && this.general.nationId === 0 && !this.generalPolicy.can('국가선택')) {
            return this.buildGeneralCandidate(ACTION_REST, {}, 'neutral_user');
        }

        if (this.general.npcState >= 2 && this.general.officerLevel === 12 && !this.nation?.capitalCityId) {
            const relYearMonth =
                joinYearMonth(this.world.currentYear, this.world.currentMonth) -
                joinYearMonth(this.scenarioMeta?.startYear ?? this.startYear, 1);
            if (relYearMonth > 1) {
                const establish = generalActionHandlers['건국']?.(this);
                if (establish) {
                    return establish;
                }
            }
            const move = generalActionHandlers['방랑군이동']?.(this);
            if (move) {
                return move;
            }
        }

        for (const actionName of this.generalPolicy.priority) {
            if (!this.generalPolicy.can(actionName)) {
                continue;
            }
            const handler = generalActionHandlers[actionName];
            if (!handler) {
                continue;
            }
            const result = handler(this);
            if (result) {
                return result;
            }
        }

        const neutral = generalActionHandlers['중립']?.(this);
        return neutral ?? this.buildGeneralCandidate(ACTION_REST, {}, 'neutral');
    }

    buildGeneralCandidate(action: string, args: Record<string, unknown>, reason: string): AiCommandCandidate | null {
        return this.buildCandidate(this.generalDefinitions, this.generalFallback, action, args, reason);
    }

    buildNationCandidate(action: string, args: Record<string, unknown>, reason: string): AiCommandCandidate | null {
        return this.buildCandidate(this.nationDefinitions, this.nationFallback, action, args, reason);
    }

    getReservedTurn(generalId: number): ReservedTurnEntry {
        return this.reservedTurnProvider.getGeneralTurn(generalId, 0);
    }

    calcNationDevelopedRate(): Record<string, number> {
        if (this.devRate) {
            return this.devRate;
        }
        this.categorizeNationCities();
        const devRate: Record<string, number> = { all: 0 };
        const cities = Object.values(this.supplyCities);
        if (cities.length === 0) {
            this.devRate = devRate;
            return devRate;
        }

        for (const city of cities) {
            const entries = this.calcCityDevelRate(city);
            for (const [key, [score]] of Object.entries(entries)) {
                if (key === 'trust') {
                    continue;
                }
                devRate[key] = (devRate[key] ?? 0) + score;
                devRate.all += score;
            }
        }
        for (const key of Object.keys(devRate)) {
            devRate[key] /= cities.length;
        }
        devRate.all /= Math.max(1, Object.keys(devRate).length - 1);
        this.devRate = devRate;
        return devRate;
    }

    calcCityDevelRate(city: City): Record<string, [number, number]> {
        const trust = readMetaNumber(asRecord(city.meta), 'trust', 0) / 100;
        return {
            trust: [trust, t통솔장],
            pop: [city.populationMax > 0 ? city.population / city.populationMax : 0, t통솔장],
            agri: [city.agricultureMax > 0 ? city.agriculture / city.agricultureMax : 0, t지장],
            comm: [city.commerceMax > 0 ? city.commerce / city.commerceMax : 0, t지장],
            secu: [city.securityMax > 0 ? city.security / city.securityMax : 0, t무장],
            def: [city.defenceMax > 0 ? city.defence / city.defenceMax : 0, t무장],
            wall: [city.wallMax > 0 ? city.wall / city.wallMax : 0, t무장],
        };
    }

    calcWarRoute(): void {
        if (this.warRoute || !this.map || !this.worldRef) {
            return;
        }
        const target = Object.keys(this.warTargetNation).map((key) => Number(key));
        if (this.nation) {
            target.push(this.nation.id);
        }
        this.warRoute = searchAllDistanceByNationList(this.map, this.worldRef.listCities(), target, false);
    }

    categorizeNationCities(): void {
        if (this.categorizedCities) {
            return;
        }
        this.categorizedCities = true;

        if (!this.nation || !this.worldRef) {
            return;
        }

        const nationId = this.nation.id;
        const nationCities: Record<
            number,
            City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
        > = {};
        const frontCities: Record<
            number,
            City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
        > = {};
        const supplyCities: Record<
            number,
            City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
        > = {};
        const backupCities: Record<
            number,
            City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
        > = {};

        for (const city of this.worldRef.listCities()) {
            if (city.nationId !== nationId) {
                continue;
            }
            const max = city.agricultureMax + city.commerceMax + city.securityMax + city.defenceMax + city.wallMax;
            const dev =
                max > 0 ? (city.agriculture + city.commerce + city.security + city.defence + city.wall) / max : 0;
            const entry = { ...city, dev, important: 1, generals: {} as Record<number, TurnGeneral> };
            nationCities[city.id] = entry;
            if (city.supplyState > 0) {
                supplyCities[city.id] = entry;
                if (city.frontState <= 0) {
                    backupCities[city.id] = entry;
                }
            }
            if (city.frontState > 0) {
                frontCities[city.id] = entry;
            }
        }

        this.nationCities = nationCities;
        this.frontCities = frontCities;
        this.supplyCities = supplyCities;
        this.backupCities = backupCities;
    }

    categorizeNationGeneral(): void {
        if (this.categorizedGenerals) {
            return;
        }
        this.categorizedGenerals = true;

        if (!this.nation || !this.worldRef) {
            return;
        }

        this.categorizeNationCities();

        const nationId = this.nation.id;
        const nationGenerals = this.worldRef
            .listGenerals()
            .filter((general) => general.nationId === nationId && general.id !== this.general.id);

        const userGenerals: Record<number, TurnGeneral> = {};
        const userCivilGenerals: Record<number, TurnGeneral> = {};
        const userWarGenerals: Record<number, TurnGeneral> = {};
        const lostGenerals: Record<number, TurnGeneral> = {};
        const npcCivilGenerals: Record<number, TurnGeneral> = {};
        const npcWarGenerals: Record<number, TurnGeneral> = {};
        const troopLeaders: Record<number, TurnGeneral> = {};
        const chiefGenerals: Record<number, TurnGeneral> = {};

        let lastWar = Number.MAX_SAFE_INTEGER;
        for (const candidate of nationGenerals) {
            const belong = readMetaNumber(asRecord(candidate.meta), 'belong', 0);
            const recentWarTurn = this.calcRecentWarTurn(candidate);
            if (belong > 0 && recentWarTurn >= (belong - 1) * 12) {
                continue;
            }
            lastWar = Math.min(lastWar, recentWarTurn);
        }

        for (const candidate of nationGenerals) {
            const officerLevel = candidate.officerLevel;
            const npcType = candidate.npcState;
            const officerCity = readMetaNumber(
                asRecord(candidate.meta),
                'officer_city',
                readMetaNumber(asRecord(candidate.meta), 'officerCity', 0)
            );

            if (officerLevel > 4) {
                chiefGenerals[officerLevel] = candidate;
            } else if (officerLevel >= 2 && officerCity > 0 && this.nationCities[officerCity]) {
                this.nationCities[officerCity].important += 1;
            }

            const cityId = candidate.cityId;
            const city = this.nationCities[cityId];
            if (city) {
                city.generals ??= {};
                city.generals[candidate.id] = candidate;
                if (city.supplyState <= 0) {
                    lostGenerals[candidate.id] = candidate;
                }
            } else {
                lostGenerals[candidate.id] = candidate;
            }

            const isTroopLeader =
                npcType === 5 ||
                (candidate.troopId === candidate.id && this.getReservedTurn(candidate.id).action === 'che_집합');
            if (isTroopLeader) {
                troopLeaders[candidate.id] = candidate;
                continue;
            }

            const killturn = readMetaNumber(asRecord(candidate.meta), 'killturn', 999);
            if (killturn <= 5) {
                npcCivilGenerals[candidate.id] = candidate;
                continue;
            }

            if (npcType < 2) {
                userGenerals[candidate.id] = candidate;
                const recentWarTurn = this.calcRecentWarTurn(candidate);
                if (recentWarTurn <= lastWar + 12) {
                    userWarGenerals[candidate.id] = candidate;
                } else if (this.dipState !== d평화 && candidate.crew >= this.nationPolicy.minWarCrew) {
                    userWarGenerals[candidate.id] = candidate;
                } else {
                    userCivilGenerals[candidate.id] = candidate;
                }
                continue;
            }

            if (candidate.stats.leadership >= this.nationPolicy.minNpcWarLeadership) {
                npcWarGenerals[candidate.id] = candidate;
            } else {
                npcCivilGenerals[candidate.id] = candidate;
            }
        }

        this.nationGenerals = nationGenerals;
        this.userGenerals = userGenerals;
        this.userCivilGenerals = userCivilGenerals;
        this.userWarGenerals = userWarGenerals;
        this.lostGenerals = lostGenerals;
        this.npcCivilGenerals = npcCivilGenerals;
        this.npcWarGenerals = npcWarGenerals;
        this.troopLeaders = troopLeaders;
        this.chiefGenerals = chiefGenerals;
    }

    private updateInstance(): void {
        if (!this.reqUpdateInstance) {
            return;
        }
        this.reqUpdateInstance = false;

        const nation = this.nation;
        if (!nation) {
            return;
        }

        const baseDevelCost = this.commandEnv.develCost * 12;
        const nationMeta = asRecord(nation.meta);
        const prevIncomeGold = readMetaNumber(nationMeta, 'prev_income_gold', 1000);
        const prevIncomeRice = readMetaNumber(nationMeta, 'prev_income_rice', 1000);
        const elapsedYears = this.world.currentYear - this.startYear - 3;
        const maxCandidate = Math.max(
            this.nationPolicy.minimumResourceActionAmount,
            prevIncomeGold / 10,
            prevIncomeRice / 10,
            nation.gold / 5,
            nation.rice / 5,
            elapsedYears * 1000
        );
        this.maxResourceActionAmount = valueFit(
            roundTo(maxCandidate, -2),
            null,
            this.nationPolicy.maximumResourceActionAmount
        );
        if (this.maxResourceActionAmount > this.aiConst.maxResourceActionAmount) {
            this.maxResourceActionAmount = this.aiConst.maxResourceActionAmount;
        }

        this.calcDiplomacyState();
        this.genType = this.calcGenType();

        void baseDevelCost;
    }

    private buildCandidate(
        definitions: Map<string, GeneralActionDefinition>,
        fallback: GeneralActionDefinition,
        action: string,
        args: Record<string, unknown>,
        reason: string
    ): AiCommandCandidate | null {
        const definition = definitions.get(action) ?? fallback;
        const parsedArgs = definition.parseArgs(args);
        if (parsedArgs === null) {
            return null;
        }
        const constraintEnv = this.buildConstraintEnv();
        const ctx: ConstraintContext = {
            actorId: this.general.id,
            cityId: this.city?.id,
            nationId: this.general.nationId,
            args: parsedArgs as Record<string, unknown>,
            env: constraintEnv,
            mode: 'full',
        };
        const view = new WorldStateView(this.worldRef, constraintEnv, parsedArgs as Record<string, unknown>, {
            general: this.general,
            city: this.city,
            nation: this.nation ?? null,
        });
        const constraints = definition.buildConstraints(ctx, parsedArgs as never);
        const result = evaluateConstraints(constraints, ctx, view);
        if (result.kind !== 'allow') {
            return null;
        }
        return {
            action: definition.key,
            args: parsedArgs as Record<string, unknown>,
            reason,
        };
    }

    private buildConstraintEnv(): ConstraintEnv {
        return {
            ...this.env,
            cities: this.worldRef?.listCities() ?? [],
            nations: this.worldRef?.listNations() ?? [],
            map: this.map,
            unitSet: this.unitSet,
        };
    }

    private calcGenType(): number {
        const leadership = this.general.stats.leadership;
        const strength = Math.max(this.general.stats.strength, 1);
        const intel = Math.max(this.general.stats.intelligence, 1);
        let genType = 0;

        if (strength >= intel) {
            genType = t무장;
            if (intel >= strength * 0.8) {
                if (this.rng.nextBool(intel / strength / 2)) {
                    genType |= t지장;
                }
            }
        } else {
            genType = t지장;
            if (strength >= intel * 0.8) {
                if (this.rng.nextBool(strength / intel / 2)) {
                    genType |= t무장;
                }
            }
        }

        if (leadership >= this.nationPolicy.minNpcWarLeadership) {
            genType |= t통솔장;
        }

        return genType;
    }

    private calcDiplomacyState(): void {
        if (!this.nation || !this.worldRef) {
            return;
        }
        const nationId = this.nation.id;
        const yearMonth = joinYearMonth(this.world.currentYear, this.world.currentMonth);
        const startYearMonth = joinYearMonth(this.startYear + 2, 5);

        const warTargets = this.worldRef
            .listDiplomacy()
            .filter((entry) => entry.fromNationId === nationId && (entry.state === 0 || entry.state === 1));

        if (yearMonth <= startYearMonth) {
            this.dipState = warTargets.length === 0 ? d평화 : d선포;
            this.attackable = false;
            return;
        }

        const frontStatus = this.worldRef
            .listCities()
            .some((city) => city.nationId === nationId && city.supplyState > 0 && city.frontState > 0);
        this.attackable = frontStatus;

        let onWar = 0;
        let onWarReady = 0;
        const warTargetNation: Record<number, number> = {};
        for (const entry of warTargets) {
            if (entry.state === 0) {
                onWar += 1;
                warTargetNation[entry.toNationId] = 2;
            } else if (entry.state === 1 && entry.term < 5) {
                onWarReady += 1;
                warTargetNation[entry.toNationId] = 1;
            }
        }
        if (onWar === 0 && onWarReady === 0) {
            warTargetNation[0] = 1;
        }
        this.warTargetNation = warTargetNation;

        const declareTerms = warTargets.filter((entry) => entry.state === 1).map((entry) => entry.term);
        const minWarTerm = declareTerms.length > 0 ? Math.min(...declareTerms) : null;
        if (minWarTerm === null) {
            this.dipState = d평화;
        } else if (minWarTerm > 8) {
            this.dipState = d선포;
        } else if (minWarTerm > 5) {
            this.dipState = d징병;
        } else {
            this.dipState = d직전;
        }

        const meta = asRecord(this.nation.meta);
        const lastAttackable = readMetaNumber(meta, 'last_attackable', 0);
        if (Object.prototype.hasOwnProperty.call(warTargetNation, 0) && this.attackable) {
            this.dipState = d전쟁;
        } else if (onWar > 0) {
            if (this.attackable) {
                this.dipState = d전쟁;
            } else if (lastAttackable >= yearMonth - 5) {
                this.dipState = d전쟁;
            }
        }
    }

    private calcRecentWarTurn(general: TurnGeneral): number {
        const recent = general.recentWarTime;
        if (!recent) {
            return 12000;
        }
        const diffMs = general.turnTime.getTime() - recent.getTime();
        if (diffMs <= 0) {
            return 0;
        }
        const turnMs = this.turnTermMinutes * 60 * 1000;
        if (turnMs <= 0) {
            return 12000;
        }
        return Math.floor(diffMs / turnMs);
    }
}

export const shouldUseAi = (general: TurnGeneral, world: TurnWorldState): boolean => {
    if (general.npcState >= 2) {
        return true;
    }
    const meta = asRecord(general.meta);
    const limit = readMetaNumber(meta, 'autorun_limit', 0);
    if (limit <= 0) {
        return false;
    }
    const current = joinYearMonth(world.currentYear, world.currentMonth);
    return current < limit;
};
