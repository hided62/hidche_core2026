import type { City, General, GeneralTriggerState, Nation, TriggerValue } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, RequirementKey, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    occupiedCity,
    reqCityCapacity,
    reqCityTrust,
    reqGeneralCrewMargin,
    reqGeneralGold,
    reqGeneralRice,
} from '@sammo-ts/logic/constraints/presets.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import type { MapDefinition, UnitSetDefinition } from '@sammo-ts/logic/world/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { resolveStartYear } from '@sammo-ts/logic/actions/turn/actionContextHelpers.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';
import {
    type CrewTypeAvailabilityContext,
    findCrewTypeById,
    getTechCost,
    isCrewTypeAvailable,
} from '@sammo-ts/logic/world/unitSet.js';
import { parseArgsWithSchema } from '../parseArgs.js';

export interface RecruitEnvironment {
    costOffset?: number;
    defaultTrain?: number;
    defaultAtmos?: number;
    minAvailableRecruitPop?: number;
    defaultTrust?: number;
}

export interface RecruitResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    map: MapDefinition;
    unitSet: UnitSetDefinition;
    cities: City[];
    currentYear?: number;
    startYear?: number;
}

const ACTION_NAME = '징병';
const DEFAULT_COST_OFFSET = 1;
const DEFAULT_TRAIN = 40;
const DEFAULT_ATMOS = 40;
const DEFAULT_MIN_POP = 30000;
const DEFAULT_TRUST = 50;
const MIN_CREW = 100;
export const ARGS_SCHEMA = z.preprocess(
    (raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return raw;
        }
        const record = raw as Record<string, unknown>;
        const crewType = record.crewType ?? record.crewTypeId;
        return { ...record, crewType };
    },
    z.object({
        crewType: z.preprocess(
            (value) => (typeof value === 'number' ? Math.floor(value) : value),
            z.number().int().positive()
        ),
        amount: z.preprocess(
            (value) => (typeof value === 'number' ? Math.floor(value) : value),
            z.number().int().min(0)
        ),
    })
);
export type RecruitArgs = z.infer<typeof ARGS_SCHEMA>;

const clamp = (value: number, min: number | null, max: number | null): number => {
    if (max !== null && min !== null && max < min) {
        return min;
    }
    if (min !== null && value < min) {
        return min;
    }
    if (max !== null && value > max) {
        return max;
    }
    return value;
};

const readNationTech = (nation: Nation | null | undefined): number => {
    if (!nation) {
        return 0;
    }
    const tech = nation.meta.tech;
    return typeof tech === 'number' ? tech : 0;
};

const readCityTrust = (city: City, fallback: number): number => {
    const meta = city.meta as Record<string, unknown>;
    const trust = meta?.trust;
    return typeof trust === 'number' ? trust : fallback;
};

const addMetaNumber = (
    meta: Record<string, TriggerValue>,
    key: string,
    delta: number
): Record<string, TriggerValue> => {
    const current = typeof meta[key] === 'number' ? (meta[key] as number) : 0;
    return { ...meta, [key]: current + delta };
};

const resolveCrewTypeId = (args: Record<string, unknown>): number | null => {
    const raw = args.crewType ?? args.crewTypeId;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    const value = Math.floor(raw);
    return value > 0 ? value : null;
};

const resolveCrewAmount = (args: Record<string, unknown>): number | null => {
    const raw = args.amount;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    const value = Math.floor(raw);
    if (value < 0) {
        return null;
    }
    return value;
};

const buildCrewTypeContext = (ctx: ConstraintContext, view: StateView): CrewTypeAvailabilityContext | null => {
    const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
    const general = view.get(generalReq) as General | null;
    if (!general) {
        return null;
    }
    const nationId = ctx.nationId ?? general.nationId;
    const nationReq: RequirementKey = { kind: 'nation', id: nationId };
    const nation = nationId > 0 ? ((view.get(nationReq) as Nation | null) ?? null) : null;
    const map = ctx.env.map;
    const cities = ctx.env.cities;
    if (!map || !cities || !Array.isArray(cities)) {
        return null;
    }
    const currentYear =
        typeof ctx.env.currentYear === 'number'
            ? ctx.env.currentYear
            : typeof ctx.env.year === 'number'
              ? ctx.env.year
              : undefined;
    const startYear = typeof ctx.env.startYear === 'number' ? ctx.env.startYear : undefined;
    const result: CrewTypeAvailabilityContext = {
        general,
        nation,
        map: map as MapDefinition,
        cities: cities as City[],
    };
    if (currentYear !== undefined) {
        result.currentYear = currentYear;
    }
    if (startYear !== undefined) {
        result.startYear = startYear;
    }
    return result;
};

type RecruitCalcContext<TriggerState extends GeneralTriggerState = GeneralTriggerState> = {
    general: General<TriggerState>;
    city?: City;
    nation?: Nation | null;
};

const buildCalcContext = <TriggerState extends GeneralTriggerState>(
    ctx: ConstraintContext,
    view: StateView
): RecruitCalcContext<TriggerState> | null => {
    const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
    const general = view.get(generalReq) as General<TriggerState> | null;
    if (!general) {
        return null;
    }
    const nationId = ctx.nationId ?? general.nationId;
    const nationReq: RequirementKey = { kind: 'nation', id: nationId };
    const nation = nationId > 0 ? ((view.get(nationReq) as Nation | null) ?? null) : null;
    const city =
        ctx.cityId !== undefined
            ? ((view.get({ kind: 'city', id: ctx.cityId }) as City | null) ?? undefined)
            : undefined;
    const result: RecruitCalcContext<TriggerState> = { general };
    if (city) {
        result.city = city;
    }
    if (nation !== undefined) {
        result.nation = nation;
    }
    return result;
};

export class CommandResolver<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    // 징병 명령의 비용/훈련/사기 계산을 담당한다.
    private readonly pipeline: GeneralActionPipeline<TriggerState>;
    private readonly env: RecruitEnvironment;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: RecruitEnvironment) {
        this.pipeline = new GeneralActionPipeline(modules);
        this.env = env;
    }

    resolveLeadership(context: RecruitCalcContext<TriggerState>): number {
        const base = context.general.stats.leadership;
        return Math.round(this.pipeline.onCalcStat(context, 'leadership', base));
    }

    resolveCrewPlan(
        context: RecruitCalcContext<TriggerState>,
        crewTypeId: number,
        amount: number
    ): { requested: number; applied: number } {
        const leadership = this.resolveLeadership(context);
        let maxCrew = leadership * 100;
        if (crewTypeId === context.general.crewTypeId) {
            maxCrew -= context.general.crew;
        }
        const requested = clamp(amount, MIN_CREW, null);
        const applied = clamp(amount, MIN_CREW, maxCrew);
        return { requested, applied };
    }

    getCost(
        context: RecruitCalcContext<TriggerState>,
        crewTypeId: number,
        amount: number,
        crewType?: { armType: number; cost: number }
    ): { gold: number; rice: number; applied: number; requested: number } {
        const plan = this.resolveCrewPlan(context, crewTypeId, amount);
        const tech = readNationTech(context.nation ?? null);
        const costOffset = this.env.costOffset ?? DEFAULT_COST_OFFSET;
        const baseGold = crewType ? (crewType.cost * getTechCost(tech) * plan.applied) / 100 : 0;
        const adjustedGold = this.pipeline.onCalcDomestic(
            context,
            ACTION_NAME,
            'cost',
            baseGold,
            crewType ? { armType: crewType.armType } : undefined
        );
        const baseRice = plan.applied / 100;
        const adjustedRice = this.pipeline.onCalcDomestic(
            context,
            ACTION_NAME,
            'rice',
            baseRice,
            crewType ? { armType: crewType.armType } : undefined
        );
        return {
            gold: Math.round(adjustedGold * costOffset),
            rice: Math.round(adjustedRice),
            applied: plan.applied,
            requested: plan.requested,
        };
    }

    getTrain(context: RecruitCalcContext<TriggerState>, crewType?: { armType: number }): number {
        const base = this.env.defaultTrain ?? DEFAULT_TRAIN;
        return this.pipeline.onCalcDomestic(
            context,
            ACTION_NAME,
            'train',
            base,
            crewType ? { armType: crewType.armType } : undefined
        );
    }

    getAtmos(context: RecruitCalcContext<TriggerState>, crewType?: { armType: number }): number {
        const base = this.env.defaultAtmos ?? DEFAULT_ATMOS;
        return this.pipeline.onCalcDomestic(
            context,
            ACTION_NAME,
            'atmos',
            base,
            crewType ? { armType: crewType.armType } : undefined
        );
    }

    getRecruitPopulation(context: RecruitCalcContext<TriggerState>, amount: number): number {
        const base = this.pipeline.onCalcDomestic(context, '징집인구', 'score', amount);
        return Math.round(base);
    }
}

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, RecruitArgs> {
    readonly key = 'che_징병';
    // 징병 실행 결과를 계산하고 효과로 변환한다.
    private readonly env: RecruitEnvironment;
    private readonly command: CommandResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: RecruitEnvironment) {
        this.env = env;
        this.command = new CommandResolver(modules, env);
    }

    resolve(context: RecruitResolveContext<TriggerState>, args: RecruitArgs): GeneralActionOutcome<TriggerState> {
        const { general, city } = context;
        if (!city) {
            context.addLog('도시 정보가 없습니다.');
            return { effects: [] };
        }

        const crewType = findCrewTypeById(context.unitSet, args.crewType);
        if (!crewType) {
            context.addLog('병종 정보가 없습니다.');
            return { effects: [] };
        }

        const availabilityContext: CrewTypeAvailabilityContext = {
            general,
            nation: context.nation ?? null,
            map: context.map,
            cities: context.cities,
        };
        if (context.currentYear !== undefined) {
            availabilityContext.currentYear = context.currentYear;
        }
        if (context.startYear !== undefined) {
            availabilityContext.startYear = context.startYear;
        }
        if (!isCrewTypeAvailable(context.unitSet, crewType.id, availabilityContext)) {
            context.addLog('현재 선택할 수 없는 병종입니다.');
            return { effects: [] };
        }

        const plan = this.command.getCost(context, crewType.id, args.amount, crewType);
        const setTrain = this.command.getTrain(context, crewType);
        const setAtmos = this.command.getAtmos(context, crewType);
        const appliedCrew = plan.applied;

        const costOffset = this.env.costOffset ?? DEFAULT_COST_OFFSET;
        const recruitPop = this.command.getRecruitPopulation(context, appliedCrew);
        const nextPopulation = Math.max(city.population - recruitPop, 0);
        const baseTrust = readCityTrust(city, this.env.defaultTrust ?? DEFAULT_TRUST);
        const trustLoss = city.population > 0 ? (recruitPop / city.population / costOffset) * 100 : 0;
        const nextTrust = Math.max(baseTrust - trustLoss, 0);

        let nextCrewTypeId = general.crewTypeId;
        let nextCrew = general.crew;
        let nextTrain = general.train;
        let nextAtmos = general.atmos;
        let logMessage = '';

        const crewLabel = `${crewType.name} ${appliedCrew}명`;
        if (crewType.id === general.crewTypeId && general.crew > 0) {
            nextCrew = general.crew + appliedCrew;
            nextTrain = Math.round(
                (general.crew * general.train + appliedCrew * setTrain) / (general.crew + appliedCrew)
            );
            nextAtmos = Math.round(
                (general.crew * general.atmos + appliedCrew * setAtmos) / (general.crew + appliedCrew)
            );
            logMessage = `${crewLabel} 추가 ${ACTION_NAME}했습니다.`;
        } else {
            nextCrewTypeId = crewType.id;
            nextCrew = appliedCrew;
            nextTrain = Math.round(setTrain);
            nextAtmos = Math.round(setAtmos);
            logMessage = `${crewLabel} ${ACTION_NAME}했습니다.`;
        }

        const nextGold = Math.max(0, general.gold - plan.gold);
        const nextRice = Math.max(0, general.rice - plan.rice);
        const expGain = Math.round(appliedCrew / 100);
        const dedGain = Math.round(appliedCrew / 100);

        // 직접 수정 (Immer Draft)
        city.population = nextPopulation;
        city.meta = {
            ...(city.meta as object),
            trust: nextTrust,
        };

        general.crewTypeId = nextCrewTypeId;
        general.crew = nextCrew;
        general.train = nextTrain;
        general.atmos = nextAtmos;
        general.gold = nextGold;
        general.rice = nextRice;
        general.experience += expGain;
        general.dedication += dedGain;
        general.meta = addMetaNumber(general.meta, 'leadership_exp', 1);

        context.addLog(logMessage);

        return { effects: [] };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, RecruitArgs, RecruitResolveContext<TriggerState>> {
    public readonly key: string = 'che_징병';
    public readonly name: string = ACTION_NAME;
    private readonly command: CommandResolver<TriggerState>;
    private readonly resolver: ActionResolver<TriggerState>;
    private readonly env: RecruitEnvironment;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: RecruitEnvironment) {
        this.command = new CommandResolver(modules, env);
        this.resolver = new ActionResolver(modules, env);
        this.env = env;
    }

    parseArgs(raw: unknown): RecruitArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: RecruitArgs): Constraint[] {
        const minPopBase = this.env.minAvailableRecruitPop ?? DEFAULT_MIN_POP;
        return [
            notBeNeutral(),
            occupiedCity(),
            reqCityCapacity('population', '주민', minPopBase + MIN_CREW),
            reqCityTrust(20),
        ];
    }

    buildConstraints(ctx: ConstraintContext, _args: RecruitArgs): Constraint[] {
        const requirements: RequirementKey[] = [
            { kind: 'arg', key: 'crewType' },
            { kind: 'arg', key: 'amount' },
        ];
        if (ctx.cityId !== undefined) {
            requirements.push({ kind: 'city', id: ctx.cityId });
        }
        if (ctx.nationId !== undefined) {
            requirements.push({ kind: 'nation', id: ctx.nationId });
        }

        const minPopBase = this.env.minAvailableRecruitPop ?? DEFAULT_MIN_POP;
        const resolveRequestedCrew = (context: ConstraintContext): number => {
            const amount = resolveCrewAmount(context.args);
            return clamp(amount ?? MIN_CREW, MIN_CREW, null);
        };
        const getCost = (context: ConstraintContext, view: StateView): number => {
            const crewTypeId = resolveCrewTypeId(context.args);
            if (crewTypeId === null) {
                return 0;
            }
            const calcContext = buildCalcContext<TriggerState>(context, view);
            if (!calcContext) {
                return 0;
            }
            const unitSet = context.env.unitSet as UnitSetDefinition | undefined;
            const crewType = unitSet ? findCrewTypeById(unitSet, crewTypeId) : null;
            return this.command.getCost(
                calcContext,
                crewTypeId,
                resolveCrewAmount(context.args) ?? 0,
                crewType ?? undefined
            ).gold;
        };
        const getRice = (context: ConstraintContext, view: StateView): number => {
            const crewTypeId = resolveCrewTypeId(context.args);
            if (crewTypeId === null) {
                return 0;
            }
            const calcContext = buildCalcContext<TriggerState>(context, view);
            if (!calcContext) {
                return 0;
            }
            const unitSet = context.env.unitSet as UnitSetDefinition | undefined;
            const crewType = unitSet ? findCrewTypeById(unitSet, crewTypeId) : null;
            return this.command.getCost(
                calcContext,
                crewTypeId,
                resolveCrewAmount(context.args) ?? 0,
                crewType ?? undefined
            ).rice;
        };
        const checkCrewTypeAvailable = (): Constraint => ({
            name: 'AvailableRecruitCrewType',
            requires: () => requirements,
            test: (context, view) => {
                const crewTypeId = resolveCrewTypeId(context.args);
                if (crewTypeId === null) {
                    return { kind: 'deny', reason: '병종 정보가 없습니다.' };
                }
                const unitSet = context.env.unitSet as UnitSetDefinition | undefined;
                if (!unitSet) {
                    return { kind: 'deny', reason: '병종 정보가 없습니다.' };
                }
                const availabilityContext = buildCrewTypeContext(context, view);
                if (!availabilityContext) {
                    return { kind: 'deny', reason: '병종 정보가 없습니다.' };
                }
                if (isCrewTypeAvailable(unitSet, crewTypeId, availabilityContext)) {
                    return { kind: 'allow' };
                }
                return { kind: 'deny', reason: '현재 선택할 수 없는 병종입니다.' };
            },
        });

        const constraints: Constraint[] = [
            notBeNeutral(),
            occupiedCity(),
            reqCityCapacity('population', '주민', minPopBase + resolveRequestedCrew(ctx)),
            reqCityTrust(20),
            reqGeneralGold(getCost, requirements),
            reqGeneralRice(getRice, requirements),
            reqGeneralCrewMargin((context) => resolveCrewTypeId(context.args), requirements),
        ];

        if (ctx.mode === 'full') {
            constraints.push(checkCrewTypeAvailable());
        }

        return constraints;
    }

    resolve(context: RecruitResolveContext<TriggerState>, args: RecruitArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행에 필요한 지도/연도 컨텍스트를 구성한다.
export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    if (!options.map || !options.unitSet) {
        return null;
    }
    return {
        ...base,
        map: options.map,
        unitSet: options.unitSet,
        cities: options.worldRef?.listCities() ?? [],
        currentYear: options.world.currentYear,
        startYear: resolveStartYear(options.world, options.scenarioMeta),
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_징병',
    category: '내정',
    reqArg: true,
    availabilityArgs: {},
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? [], {}),
};
