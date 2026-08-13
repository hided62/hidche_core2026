import type {
    City,
    Constraint,
    ConstraintContext,
    ConstraintResult,
    General,
    GeneralItemSlots,
    GeneralActionDefinition,
    GeneralTurnCommandSpec,
    MapDefinition,
    Nation,
    NationTurnCommandSpec,
    RequirementKey,
    StateView,
    TurnCommandEnv,
    TriggerValue,
    UnitSetDefinition,
} from '@sammo-ts/logic';
import { evaluateConstraints } from '@sammo-ts/logic';
import type { GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';
import { CommandResolver as RecruitmentCommandResolver } from '@sammo-ts/logic/actions/turn/general/che_징병.js';
import { projectItemSlots, readItemInventoryFromMeta } from '@sammo-ts/logic/items/index.js';
import { getTechAbility, getTechLevel, isCrewTypeAvailable } from '@sammo-ts/logic/world/unitSet.js';
import { asRecord, isRecord } from '@sammo-ts/common';

import type { CityRow, GeneralRow, NationRow, WorldStateRow } from '../context.js';
import {
    buildTurnCommandInputFields,
    loadTurnCommandSpecs,
    type TurnCommandInputField,
    type TurnCommandInputOptions,
    type TurnCommandRecruitmentInfo,
} from './commandInput.js';

type AvailabilityStatus = 'available' | 'blocked' | 'needsInput' | 'unknown';

export interface TurnCommandAvailability {
    key: string;
    name: string;
    reqArg: boolean;
    possible: boolean;
    status: AvailabilityStatus;
    reason?: string;
    inputFields: TurnCommandInputField[];
}

export interface TurnCommandGroup {
    category: string;
    values: TurnCommandAvailability[];
}

export interface TurnCommandTable {
    general: TurnCommandGroup[];
    nation: TurnCommandGroup[];
    inputOptions: TurnCommandInputOptions;
}

type CommandEnv = TurnCommandEnv;

interface AvailabilityCore {
    possible: boolean;
    status: AvailabilityStatus;
    reason?: string;
}

interface CommandEntry {
    category: string;
    definition: GeneralActionDefinition;
    reqArg: boolean;
    availabilityArgs: Readonly<Record<string, unknown>>;
    inputFields: TurnCommandInputField[];
    evaluate?: (ctx: ConstraintContext, view: StateView) => AvailabilityCore;
}

const INPUT_REQUIREMENT_KINDS = new Set<RequirementKey['kind']>([
    'destGeneral',
    'destCity',
    'destNation',
    'diplomacy',
    'arg',
]);

const AVAILABILITY_PRIORITY: Record<AvailabilityStatus, number> = {
    available: 3,
    needsInput: 2,
    unknown: 1,
    blocked: 0,
};

const DEFAULT_GENERAL_GOLD = 1000;
const DEFAULT_GENERAL_RICE = 1000;
const DEFAULT_CREW_TYPE_ID = 1100;

const asTriggerRecord = (value: unknown): Record<string, TriggerValue> =>
    isRecord(value) ? (value as Record<string, TriggerValue>) : {};

const readMetaNumber = (meta: Record<string, TriggerValue>, key: string): number | null => {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
};

const ensureGeneralMeta = (meta: Record<string, TriggerValue>, generalId: number): General['meta'] => {
    const killturn = readMetaNumber(meta, 'killturn');
    if (killturn === null) {
        throw new Error(`general.meta.killturn is required (generalId=${generalId}).`);
    }
    return { ...meta, killturn } as General['meta'];
};

const normalizeCode = (value: string | null | undefined): string | null => {
    if (!value || value === 'None') {
        return null;
    }
    return value;
};

class MemoryStateView implements StateView {
    private readonly store = new Map<string, unknown>();

    has(req: RequirementKey): boolean {
        return this.store.has(this.getKey(req));
    }

    get(req: RequirementKey): unknown | null {
        return this.store.get(this.getKey(req)) ?? null;
    }

    set(req: RequirementKey, value: unknown): void {
        this.store.set(this.getKey(req), value);
    }

    private getKey(req: RequirementKey): string {
        switch (req.kind) {
            case 'general':
                return `general:${req.id}`;
            case 'generalList':
                return 'general:list';
            case 'city':
                return `city:${req.id}`;
            case 'nation':
                return `nation:${req.id}`;
            case 'destGeneral':
                return `destGeneral:${req.id}`;
            case 'destCity':
                return `destCity:${req.id}`;
            case 'destNation':
                return `destNation:${req.id}`;
            case 'diplomacy':
                return `diplomacy:${req.srcNationId}:${req.destNationId}`;
            case 'diplomacyList':
                return 'diplomacy:list';
            case 'arg':
                return `arg:${req.key}`;
            case 'env':
                return `env:${req.key}`;
            default:
                return 'unknown';
        }
    }
}

const resolveNumber = (source: Record<string, unknown>, keys: string[], fallback: number): number => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
};

const resolveOptionalString = (source: Record<string, unknown>, keys: string[]): string | null => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string') {
            return normalizeCode(value);
        }
    }
    return null;
};

const buildCommandEnv = (worldState: WorldStateRow): CommandEnv => {
    const config = asRecord(worldState.config);
    const constValues = asRecord(config.const);

    return {
        develCost: resolveNumber(constValues, ['develCost', 'develcost', 'develrate'], 0),
        trainDelta: resolveNumber(constValues, ['trainDelta'], 0),
        atmosDelta: resolveNumber(constValues, ['atmosDelta'], 0),
        trainSideEffectByAtmosTurn: resolveNumber(constValues, ['trainSideEffectByAtmosTurn'], 1),
        maxTrainByCommand: resolveNumber(constValues, ['maxTrainByCommand'], 0),
        maxAtmosByCommand: resolveNumber(constValues, ['maxAtmosByCommand'], 0),
        sabotageDefaultProb: resolveNumber(constValues, ['sabotageDefaultProb'], 0),
        sabotageProbCoefByStat: resolveNumber(constValues, ['sabotageProbCoefByStat'], 0),
        sabotageDefenceCoefByGeneralCount: resolveNumber(constValues, ['sabotageDefenceCoefByGeneralCount'], 0),
        sabotageDamageMin: resolveNumber(constValues, ['sabotageDamageMin'], 0),
        sabotageDamageMax: resolveNumber(constValues, ['sabotageDamageMax'], 0),
        openingPartYear: resolveNumber(constValues, ['openingPartYear'], 0),
        maxGeneral: resolveNumber(constValues, ['defaultMaxGeneral', 'maxGeneral'], 0),
        defaultNpcGold: resolveNumber(constValues, ['defaultNpcGold', 'defaultGold'], DEFAULT_GENERAL_GOLD),
        defaultNpcRice: resolveNumber(constValues, ['defaultNpcRice', 'defaultRice'], DEFAULT_GENERAL_RICE),
        defaultCrewTypeId: resolveNumber(constValues, ['defaultCrewTypeId'], DEFAULT_CREW_TYPE_ID),
        defaultSpecialDomestic: resolveOptionalString(constValues, ['defaultSpecialDomestic']),
        defaultSpecialWar: resolveOptionalString(constValues, ['defaultSpecialWar']),
        initialNationGenLimit: resolveNumber(constValues, ['initialNationGenLimit'], 0),
        maxTechLevel: resolveNumber(constValues, ['maxTechLevel'], 12),
        maxStatLevel: resolveNumber(constValues, ['maxLevel'], 255),
        techLevelIncYear: resolveNumber(constValues, ['techLevelIncYear'], 5),
        initialAllowedTechLevel: resolveNumber(constValues, ['initialAllowedTechLevel'], 1),
        baseGold: resolveNumber(constValues, ['baseGold', 'basegold'], 0),
        baseRice: resolveNumber(constValues, ['baseRice', 'baserice'], 0),
        generalMinimumGold: resolveNumber(constValues, ['generalMinimumGold'], 0),
        generalMinimumRice: resolveNumber(constValues, ['generalMinimumRice'], 500),
        npcSeizureMessageProb: resolveNumber(constValues, ['npcSeizureMessageProb'], 0.01),
        maxResourceActionAmount: resolveNumber(constValues, ['maxResourceActionAmount'], 0),
    };
};

const buildConstraintEnv = (worldState: WorldStateRow): Record<string, unknown> => {
    const config = asRecord(worldState.config);
    const constValues = asRecord(config.const);
    const meta = asRecord(worldState.meta);
    const scenarioMeta = asRecord(meta.scenarioMeta);
    const startYear = typeof scenarioMeta.startYear === 'number' ? scenarioMeta.startYear : undefined;
    const relYear = typeof startYear === 'number' ? worldState.currentYear - startYear : undefined;
    const joinModeRaw = config.join_mode ?? config.joinMode;
    const joinMode = typeof joinModeRaw === 'string' ? joinModeRaw : 'full';

    return {
        currentYear: worldState.currentYear,
        currentMonth: worldState.currentMonth,
        year: worldState.currentYear,
        month: worldState.currentMonth,
        startYear,
        relYear,
        join_mode: joinMode,
        openingPartYear: resolveNumber(constValues, ['openingPartYear'], 0),
    };
};

const mapGeneralRow = (row: GeneralRow, missingKillturnFallback?: number): General => {
    const legacySlots: GeneralItemSlots = {
        horse: normalizeCode(row.horseCode),
        weapon: normalizeCode(row.weaponCode),
        book: normalizeCode(row.bookCode),
        item: normalizeCode(row.itemCode),
    };
    const rawMeta = asTriggerRecord(row.meta);
    const meta =
        readMetaNumber(rawMeta, 'killturn') === null && missingKillturnFallback !== undefined
            ? ({ ...rawMeta, killturn: missingKillturnFallback } as General['meta'])
            : ensureGeneralMeta(rawMeta, row.id);
    const itemInventory = readItemInventoryFromMeta(meta, legacySlots);
    return {
        id: row.id,
        name: row.name,
        nationId: row.nationId,
        cityId: row.cityId,
        troopId: row.troopId,
        stats: {
            leadership: row.leadership,
            strength: row.strength,
            intelligence: row.intel,
        },
        experience: row.experience,
        dedication: row.dedication,
        officerLevel: row.officerLevel,
        role: {
            personality: normalizeCode(row.personalCode),
            specialDomestic: normalizeCode(row.specialCode),
            specialWar: normalizeCode(row.special2Code),
            items: projectItemSlots(itemInventory),
        },
        injury: row.injury,
        gold: row.gold,
        rice: row.rice,
        crew: row.crew,
        crewTypeId: row.crewTypeId,
        train: row.train,
        atmos: row.atmos,
        age: row.age,
        npcState: row.npcState,
        triggerState: {
            flags: {},
            counters: {},
            modifiers: {},
            meta: {},
        },
        itemInventory,
        meta,
    };
};

const mapCityRow = (row: CityRow): City => {
    const meta = asTriggerRecord(row.meta);
    const state = typeof meta.state === 'number' && Number.isFinite(meta.state) ? Math.floor(meta.state) : 0;
    return {
        id: row.id,
        name: row.name,
        nationId: row.nationId,
        level: row.level,
        state,
        population: row.population,
        populationMax: row.populationMax,
        agriculture: row.agriculture,
        agricultureMax: row.agricultureMax,
        commerce: row.commerce,
        commerceMax: row.commerceMax,
        security: row.security,
        securityMax: row.securityMax,
        supplyState: row.supplyState,
        frontState: row.frontState,
        defence: row.defence,
        defenceMax: row.defenceMax,
        wall: row.wall,
        wallMax: row.wallMax,
        meta: {
            ...meta,
            trust: row.trust,
            ...(row.trade === null ? {} : { trade: row.trade }),
            region: row.region,
        },
    };
};

const mapNationRow = (row: NationRow): Nation => ({
    id: row.id,
    name: row.name,
    color: row.color,
    capitalCityId: row.capitalCityId,
    chiefGeneralId: null,
    gold: row.gold,
    rice: row.rice,
    power: 0,
    level: row.level,
    typeCode: row.typeCode,
    meta: {
        ...asTriggerRecord(row.meta),
        tech: row.tech,
    },
});

export const buildRecruitmentCommandInfo = (options: {
    worldState: WorldStateRow;
    general: GeneralRow;
    city: CityRow | null;
    nation: NationRow | null;
    cities: CityRow[];
    map: MapDefinition;
    unitSet: UnitSetDefinition;
    generalActionModules?: ReadonlyArray<GeneralActionModule | null | undefined>;
}): TurnCommandRecruitmentInfo => {
    const general = mapGeneralRow(options.general);
    const city = options.city ? mapCityRow(options.city) : undefined;
    const nation = options.nation ? mapNationRow(options.nation) : null;
    const cities = options.cities.map(mapCityRow);
    const context = city ? { general, city, nation } : { general, nation };
    const command = new RecruitmentCommandResolver(options.generalActionModules ?? [], {});
    const tech = options.nation?.tech ?? 0;
    const techAbility = getTechAbility(tech);
    const constraintEnv = buildConstraintEnv(options.worldState);
    const startYear = typeof constraintEnv.startYear === 'number' ? constraintEnv.startYear : undefined;
    const availabilityContext = {
        general,
        nation,
        map: options.map,
        cities,
        currentYear: options.worldState.currentYear,
        ...(startYear === undefined ? {} : { startYear }),
    };
    const crewTypes = options.unitSet.crewTypes ?? [];
    const armTypes = Object.entries(options.unitSet.armTypes ?? {})
        .map(([armType, armName]) => ({ armType: Number(armType), armName }))
        .filter((entry) => Number.isFinite(entry.armType))
        .sort((left, right) => left.armType - right.armType);

    const groups = armTypes.map(({ armType, armName }) => ({
        armType,
        armName,
        values: crewTypes
            .filter((crewType) => crewType.armType === armType)
            .map((crewType) => {
                const displayCost = command.getDisplayUnitCost(context, crewType);
                const requiredTech = crewType.requirements.find((requirement) => requirement.type === 'ReqTech');
                return {
                    id: crewType.id,
                    armType,
                    name: crewType.name,
                    available: isCrewTypeAvailable(options.unitSet, crewType.id, availabilityContext),
                    special:
                        requiredTech?.type === 'ReqTech' &&
                        typeof requiredTech.tech === 'number' &&
                        requiredTech.tech > 0,
                    attack: crewType.attack + techAbility,
                    defence: crewType.defence + techAbility,
                    speed: crewType.speed,
                    avoid: crewType.avoid,
                    baseCost: displayCost.gold,
                    baseRice: displayCost.rice,
                    info: [...crewType.info],
                };
            }),
    }));
    const currentCrewTypeName = crewTypes.find((crewType) => crewType.id === general.crewTypeId)?.name ?? '-';

    return {
        techLevel: getTechLevel(tech),
        leadership: command.resolveLeadership(context),
        fullLeadership: command.resolveFullLeadership(context),
        currentCrewTypeId: general.crewTypeId,
        currentCrewTypeName,
        crew: general.crew,
        gold: general.gold,
        groups,
    };
};

const buildStateView = (
    general: General,
    city: City | null,
    nation: Nation | null,
    generalList: General[] | null,
    env: Record<string, unknown>
): StateView => {
    const view = new MemoryStateView();
    view.set({ kind: 'general', id: general.id }, general);
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) {
            view.set({ kind: 'env', key }, value);
        }
    }
    if (city) {
        view.set({ kind: 'city', id: city.id }, city);
    }
    if (nation) {
        view.set({ kind: 'nation', id: nation.id }, nation);
    }
    if (generalList) {
        view.set({ kind: 'generalList' }, generalList);
    }
    return view;
};

const evaluateAvailability = (
    constraints: Constraint[],
    ctx: ConstraintContext,
    view: StateView,
    reqArg: boolean
): AvailabilityCore => {
    const result = evaluateConstraints(constraints, ctx, view);
    if (result.kind === 'allow') {
        return { possible: true, status: 'available' };
    }
    if (result.kind === 'deny') {
        return {
            possible: false,
            status: 'blocked',
            reason: result.reason,
        };
    }
    const missingKinds = new Set(result.missing.map((req: RequirementKey) => req.kind));
    const inputOnlyMissing =
        missingKinds.size === 0 ? reqArg : Array.from(missingKinds).every((kind) => INPUT_REQUIREMENT_KINDS.has(kind));
    if (inputOnlyMissing) {
        return {
            possible: true,
            status: 'needsInput',
            reason: '대상 선택 필요',
        };
    }
    return {
        possible: false,
        status: 'unknown',
        reason: '정보 부족',
    };
};

const evaluateDefinition = (
    definition: GeneralActionDefinition,
    ctx: ConstraintContext,
    view: StateView,
    reqArg: boolean,
    args: unknown
): AvailabilityCore => {
    const constraints =
        ctx.mode === 'precheck' && definition.buildMinConstraints
            ? definition.buildMinConstraints(ctx, args)
            : definition.buildConstraints(ctx, args);
    return evaluateAvailability(constraints, ctx, view, reqArg);
};

const pickAvailability = (lhs: AvailabilityCore, rhs: AvailabilityCore): AvailabilityCore =>
    AVAILABILITY_PRIORITY[lhs.status] >= AVAILABILITY_PRIORITY[rhs.status] ? lhs : rhs;

type TurnCommandSpec = GeneralTurnCommandSpec | NationTurnCommandSpec;

const buildEntries = (env: CommandEnv, specs: TurnCommandSpec[]): CommandEntry[] => {
    const entries: CommandEntry[] = [];

    for (const spec of specs) {
        const definition = spec.createDefinition(env);
        const entry: CommandEntry = {
            category: spec.category,
            definition,
            reqArg: spec.reqArg,
            availabilityArgs: spec.reqArg ? spec.availabilityArgs : {},
            inputFields: buildTurnCommandInputFields(spec),
        };

        if (spec.key === 'che_포상') {
            entry.evaluate = (ctx, view) => {
                const gold = evaluateDefinition(definition, ctx, view, true, {
                    isGold: true,
                    amount: 1,
                    destGeneralId: 0,
                });
                const rice = evaluateDefinition(definition, ctx, view, true, {
                    isGold: false,
                    amount: 1,
                    destGeneralId: 0,
                });
                return pickAvailability(gold, rice);
            };
        }

        entries.push(entry);
    }

    return entries;
};

const buildGroups = (entries: CommandEntry[], ctx: ConstraintContext, view: StateView): TurnCommandGroup[] => {
    const groups = new Map<string, TurnCommandAvailability[]>();

    for (const entry of entries) {
        const availability = entry.evaluate
            ? entry.evaluate(ctx, view)
            : evaluateDefinition(entry.definition, ctx, view, entry.reqArg, entry.availabilityArgs);
        const value: TurnCommandAvailability = {
            key: entry.definition.key,
            name: entry.definition.name,
            reqArg: entry.reqArg,
            inputFields: entry.inputFields,
            ...availability,
        };

        const list = groups.get(entry.category);
        if (list) {
            list.push(value);
        } else {
            groups.set(entry.category, [value]);
        }
    }

    return Array.from(groups.entries()).map(([category, values]) => ({
        category,
        values,
    }));
};

export const buildTurnCommandTable = async (options: {
    worldState: WorldStateRow;
    general: GeneralRow;
    city: CityRow | null;
    nation: NationRow | null;
    nationGenerals: GeneralRow[] | null;
    inputOptions?: TurnCommandInputOptions;
}): Promise<TurnCommandTable> => {
    // 턴 입력 화면에서 쓰는 사전 판단이므로 최소 정보로 가능/불가만 계산한다.
    const general = mapGeneralRow(options.general);
    const city = options.city ? mapCityRow(options.city) : null;
    const nation = options.nation ? mapNationRow(options.nation) : null;
    const generalList = options.nationGenerals ? options.nationGenerals.map(mapGeneralRow) : null;
    const constraintEnv = buildConstraintEnv(options.worldState);
    const view = buildStateView(general, city, nation, generalList, constraintEnv);

    const ctx: ConstraintContext = {
        actorId: general.id,
        cityId: city?.id,
        nationId: nation?.id,
        args: {},
        env: constraintEnv,
        mode: 'precheck',
    };

    const env = buildCommandEnv(options.worldState);
    const { general: generalSpecs, nation: nationSpecs } = await loadTurnCommandSpecs();
    const generalEntries = buildEntries(env, generalSpecs);
    const nationEntries = buildEntries(env, nationSpecs);

    return {
        general: buildGroups(generalEntries, ctx, view),
        nation: buildGroups(nationEntries, ctx, view),
        inputOptions: options.inputOptions ?? {
            cities: [],
            nations: [],
            generals: [],
            crewTypes: [],
            armTypes: [],
            nationTypes: [],
            colors: [],
            items: {},
            recruitment: null,
        },
    };
};

export const evaluateReservedTurnPermission = async (options: {
    worldState: WorldStateRow;
    general: GeneralRow;
    scope: 'general' | 'nation';
    action: string;
    args: Record<string, unknown>;
}): Promise<ConstraintResult> => {
    const specs = await loadTurnCommandSpecs();
    const spec = specs[options.scope].find((entry) => entry.key === options.action);
    if (!spec) {
        throw new Error(`Unknown ${options.scope} turn command: ${options.action}`);
    }

    const definition = spec.createDefinition(buildCommandEnv(options.worldState));
    if (!definition.buildPermissionConstraints) {
        return { kind: 'allow' };
    }

    const general = mapGeneralRow(options.general, 0);
    const env = buildConstraintEnv(options.worldState);
    const ctx: ConstraintContext = {
        actorId: general.id,
        cityId: general.cityId > 0 ? general.cityId : undefined,
        nationId: general.nationId > 0 ? general.nationId : undefined,
        args: options.args,
        env,
        mode: 'full',
    };
    const view = buildStateView(general, null, null, null, env);
    return evaluateConstraints(definition.buildPermissionConstraints(ctx, options.args), ctx, view);
};
