import type {
    City,
    Constraint,
    ConstraintContext,
    ConstraintResult,
    General,
    GeneralItemSlots,
    GeneralActionDefinition,
    GeneralTurnCommandSpec,
    GeneralTurnCommandKey,
    MapDefinition,
    Nation,
    NationTurnCommandKey,
    NationTurnCommandSpec,
    RequirementKey,
    StateView,
    TurnCommandEnv,
    TriggerValue,
    UnitSetDefinition,
} from '@sammo-ts/logic';
import { evaluateConstraints, LEGACY_DEFAULT_MAX_LEVEL, resolveNonAggressionMaxEndYear } from '@sammo-ts/logic';
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
    turnDurationText?: string;
    costText?: string;
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

const REF_GENERAL_COMMAND_GROUPS = [
    {
        category: '개인',
        commands: [
            '휴식',
            'che_요양',
            'che_단련',
            'che_숙련전환',
            'che_견문',
            'che_은퇴',
            'che_장비매매',
            'che_군량매매',
            'che_내정특기초기화',
            'che_전투특기초기화',
        ],
    },
    {
        category: '내정',
        commands: [
            'che_농지개간',
            'che_상업투자',
            'che_기술연구',
            'che_수비강화',
            'che_성벽보수',
            'che_치안강화',
            'che_정착장려',
            'che_주민선정',
        ],
    },
    {
        category: '군사',
        commands: [
            'che_징병',
            'che_모병',
            'che_훈련',
            'che_사기진작',
            'che_출병',
            'che_집합',
            'che_소집해제',
            'che_첩보',
        ],
    },
    {
        category: '인사',
        commands: [
            'che_이동',
            'che_강행',
            'che_인재탐색',
            'che_등용',
            'che_귀환',
            'che_임관',
            'che_랜덤임관',
            'che_장수대상임관',
        ],
    },
    {
        category: '계략',
        commands: ['che_선동', 'che_탈취', 'che_파괴', 'che_화계'],
    },
    {
        category: '국가',
        commands: ['che_증여', 'che_헌납', 'che_물자조달', 'che_하야', 'che_거병', 'che_건국', 'che_선양', 'che_해산'],
    },
] as const satisfies ReadonlyArray<{
    category: string;
    commands: ReadonlyArray<GeneralTurnCommandKey>;
}>;

const REF_NATION_COMMAND_GROUPS = [
    {
        category: '휴식',
        commands: ['휴식'],
    },
    {
        category: '인사',
        commands: ['che_발령', 'che_포상', 'che_몰수', 'che_부대탈퇴지시'],
    },
    {
        category: '외교',
        commands: ['che_물자원조', 'che_불가침제의', 'che_선전포고', 'che_종전제의', 'che_불가침파기제의'],
    },
    {
        category: '특수',
        commands: ['che_초토화', 'che_천도', 'che_증축', 'che_감축'],
    },
    {
        category: '전략',
        commands: [
            'che_필사즉생',
            'che_백성동원',
            'che_수몰',
            'che_허보',
            'che_의병모집',
            'che_이호경식',
            'che_급습',
            'che_피장파장',
        ],
    },
    {
        category: '기타',
        commands: ['che_국기변경', 'che_국호변경'],
    },
] as const satisfies ReadonlyArray<{
    category: string;
    commands: ReadonlyArray<NationTurnCommandKey>;
}>;

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

const DEFAULT_MAX_NATION = 55;

const resolveMaxNation = (worldState: WorldStateRow): number => {
    const config = asRecord(worldState.config);
    const constValues = asRecord(config.const);
    const meta = asRecord(worldState.meta);
    const refGameEnv = asRecord(meta.refGameEnv);
    const candidates = [
        refGameEnv.maxnation,
        refGameEnv.maxNation,
        config.maxnation,
        config.maxNation,
        constValues.defaultMaxNation,
        constValues.maxNation,
    ];
    for (const candidate of candidates) {
        const parsed =
            typeof candidate === 'number' ? candidate : typeof candidate === 'string' ? Number(candidate) : Number.NaN;
        if (Number.isFinite(parsed) && parsed >= 0) {
            return Math.floor(parsed);
        }
    }
    return DEFAULT_MAX_NATION;
};

const buildCommandEnv = (worldState: WorldStateRow): CommandEnv => {
    const config = asRecord(worldState.config);
    const constValues = asRecord(config.const);
    const meta = asRecord(worldState.meta);
    const configuredDevelCost = resolveNumber(constValues, ['develCost', 'develcost', 'develrate'], 0);

    return {
        // daemon은 월간 변동이 반영된 world.meta.develcost를 실행 직전에 우선한다.
        develCost: resolveNumber(meta, ['develcost', 'develCost'], configuredDevelCost),
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
        maxStatLevel: resolveNumber(constValues, ['maxLevel'], LEGACY_DEFAULT_MAX_LEVEL),
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
        maxTechLevel: resolveNumber(constValues, ['maxTechLevel'], 12),
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
    const commandEnv = buildCommandEnv(options.worldState);
    const constraintEnv = buildConstraintEnv(options.worldState);
    const configuredStartYear = typeof constraintEnv.startYear === 'number' ? constraintEnv.startYear : undefined;
    const startYear = configuredStartYear ?? options.worldState.currentYear;
    const context = {
        general,
        ...(city ? { city } : {}),
        nation,
        time: {
            year: options.worldState.currentYear,
            month: options.worldState.currentMonth,
            startYear,
        },
        maxTechLevel: commandEnv.maxTechLevel,
    };
    const command = new RecruitmentCommandResolver(options.generalActionModules ?? [], commandEnv);
    const tech = options.nation?.tech ?? 0;
    const techAbility = getTechAbility(tech, commandEnv.maxTechLevel);
    const availabilityContext = {
        general,
        nation,
        map: options.map,
        cities,
        currentYear: options.worldState.currentYear,
        ...(configuredStartYear === undefined ? {} : { startYear: configuredStartYear }),
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
        techLevel: getTechLevel(tech, commandEnv.maxTechLevel),
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

const readNextAvailableTurn = (meta: Readonly<Record<string, unknown>>, actionName: string): number | null => {
    const raw = meta[`next_execute_${actionName}`];
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.floor(raw);
    if (typeof raw === 'string') {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? Math.floor(parsed) : null;
    }
    return null;
};

const evaluateCooldown = (
    definition: GeneralActionDefinition,
    scope: 'general' | 'nation',
    ctx: ConstraintContext,
    view: StateView,
    currentYearMonth: number
): AvailabilityCore | null => {
    const owner =
        scope === 'general'
            ? (view.get({ kind: 'general', id: ctx.actorId }) as General | null)
            : ctx.nationId === undefined
              ? null
              : (view.get({ kind: 'nation', id: ctx.nationId }) as Nation | null);
    if (!owner) return null;

    const nextAvailableTurn = readNextAvailableTurn(owner.meta, definition.name);
    if (nextAvailableTurn === null || currentYearMonth >= nextAvailableTurn) return null;
    return {
        possible: false,
        status: 'blocked',
        reason: `${nextAvailableTurn - currentYearMonth}턴 더 기다려야 합니다`,
    };
};

const pickAvailability = (lhs: AvailabilityCore, rhs: AvailabilityCore): AvailabilityCore =>
    AVAILABILITY_PRIORITY[lhs.status] >= AVAILABILITY_PRIORITY[rhs.status] ? lhs : rhs;

type TurnCommandSpec = GeneralTurnCommandSpec | NationTurnCommandSpec;

const FOUNDING_COMMAND_KEYS = new Set(['che_건국', 'cr_건국', 'che_무작위건국']);

const buildEntries = (
    env: CommandEnv,
    specs: TurnCommandSpec[],
    options: { foundingAvailable?: boolean; currentYear?: number; currentMonth?: number } = {}
): CommandEntry[] => {
    const entries: CommandEntry[] = [];

    for (const spec of specs) {
        const definition = spec.createDefinition(env);
        const inputFields = buildTurnCommandInputFields(spec).map((field) => {
            if (spec.key !== 'che_불가침제의') return field;
            if (field.key === 'year' && options.currentYear !== undefined) {
                return {
                    ...field,
                    min: options.currentYear + 1,
                    max: resolveNonAggressionMaxEndYear(options.currentYear),
                    defaultValue: options.currentYear + 1,
                };
            }
            if (field.key === 'month' && options.currentMonth !== undefined) {
                return { ...field, defaultValue: options.currentMonth };
            }
            return field;
        });
        const entry: CommandEntry = {
            category: spec.category,
            definition,
            reqArg: spec.reqArg,
            availabilityArgs: spec.reqArg ? spec.availabilityArgs : {},
            inputFields,
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

        if (FOUNDING_COMMAND_KEYS.has(spec.key) && options.foundingAvailable === false) {
            entry.evaluate = () => ({
                possible: false,
                status: 'blocked',
                reason: '더 이상 건국은 불가능합니다.',
            });
        }

        entries.push(entry);
    }

    return entries;
};

const getTurnDurationText = (definition: GeneralActionDefinition): string | undefined => {
    const hint = definition.getTurnDurationHint?.();
    if (hint) return hint;

    const getPreReqTurn = definition.getPreReqTurn;
    // 인자를 선언한 구현은 천도처럼 대상에 따라 달라지므로 임의 context로 실행하지 않는다.
    if (!getPreReqTurn || getPreReqTurn.length > 0) return undefined;
    const preReqTurn = Math.max(0, Math.floor(getPreReqTurn.call(definition, undefined as never, {})));
    return preReqTurn > 0 ? `${preReqTurn + 1}턴` : undefined;
};

const formatCost = (gold: number | undefined, rice: number | undefined): string | undefined => {
    const parts = [
        gold && gold > 0 ? `금 ${gold.toLocaleString('ko-KR')}` : null,
        rice && rice > 0 ? `쌀 ${rice.toLocaleString('ko-KR')}` : null,
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(' · ') : undefined;
};

const getCommandCostText = (
    entry: CommandEntry,
    ctx: ConstraintContext,
    view: StateView,
    env: CommandEnv
): string | undefined => {
    const hint = entry.definition.getCostHint?.(ctx, view);
    if (hint?.formula) return hint.formula;
    const hintedCost = hint ? formatCost(hint.gold, hint.rice) : undefined;
    if (hintedCost) return hintedCost;

    const develCost = env.develCost;
    const general = view.get({ kind: 'general', id: ctx.actorId }) as General | null;
    switch (entry.definition.key) {
        case 'che_단련':
        case 'che_숙련전환':
            return formatCost(develCost, develCost);
        case 'che_첩보':
            return formatCost(develCost * 3, develCost * 3);
        case 'che_이동':
        case 'che_인재탐색':
            return formatCost(develCost, 0);
        case 'che_강행':
            return formatCost(develCost * 5, 0);
        case 'che_사기진작':
            return formatCost(Math.round((general?.crew ?? 0) / 100), 0);
        case 'che_출병':
            return formatCost(0, Math.round((general?.crew ?? 0) / 100));
        case 'che_천도':
            return `금·쌀 ${(develCost * 5).toLocaleString('ko-KR')} × 2^거리`;
        case 'cr_인구이동':
            return `금·쌀 ${develCost.toLocaleString('ko-KR')} × 인구[만]`;
        case 'che_증축': {
            const cost = develCost * 500 + 60_000;
            return formatCost(cost, cost);
        }
        case 'che_감축': {
            const recovery = develCost * 500 + 30_000;
            return `금 ${recovery.toLocaleString('ko-KR')} · 쌀 ${recovery.toLocaleString('ko-KR')} 회수`;
        }
        default:
            return undefined;
    }
};

const buildGroups = (
    entries: CommandEntry[],
    ctx: ConstraintContext,
    view: StateView,
    includeTurnDuration = false,
    env: CommandEnv,
    scope: 'general' | 'nation',
    currentYearMonth: number
): TurnCommandGroup[] => {
    const groups = new Map<string, TurnCommandAvailability[]>();

    for (const entry of entries) {
        const baseAvailability = entry.evaluate
            ? entry.evaluate(ctx, view)
            : evaluateDefinition(entry.definition, ctx, view, entry.reqArg, entry.availabilityArgs);
        const availability =
            baseAvailability.status === 'blocked' || baseAvailability.status === 'unknown'
                ? baseAvailability
                : (evaluateCooldown(entry.definition, scope, ctx, view, currentYearMonth) ?? baseAvailability);
        const turnDurationText = includeTurnDuration ? getTurnDurationText(entry.definition) : undefined;
        const costText = getCommandCostText(entry, ctx, view, env);
        const value: TurnCommandAvailability = {
            key: entry.definition.key,
            name: entry.definition.name,
            ...(turnDurationText ? { turnDurationText } : {}),
            ...(costText ? { costText } : {}),
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

type CommandGroupLayout = ReadonlyArray<{ category: string; commands: ReadonlyArray<string> }>;

const projectCommandGroups = (entries: CommandEntry[], layout: CommandGroupLayout): CommandEntry[] => {
    const categoryOrder = new Map<string, number>(layout.map(({ category }, index) => [category, index] as const));
    const commandPosition = new Map<string, { category: string; index: number }>(
        layout.flatMap(({ category, commands }) =>
            commands.map((command, index) => [command, { category, index }] as const)
        )
    );

    return entries
        .map((entry, profileIndex) => {
            const refPosition = commandPosition.get(entry.definition.key);
            return {
                entry: refPosition ? { ...entry, category: refPosition.category } : entry,
                categoryIndex: categoryOrder.get(refPosition?.category ?? entry.category) ?? Number.MAX_SAFE_INTEGER,
                commandIndex: refPosition?.index ?? profileIndex,
                profileIndex,
            };
        })
        .sort(
            (left, right) =>
                left.categoryIndex - right.categoryIndex ||
                left.commandIndex - right.commandIndex ||
                left.profileIndex - right.profileIndex
        )
        .map(({ entry }) => entry);
};

export const buildTurnCommandTable = async (options: {
    worldState: WorldStateRow;
    general: GeneralRow;
    city: CityRow | null;
    nation: NationRow | null;
    nationGenerals: GeneralRow[] | null;
    /** Ref's nation-table row count. Core callers must exclude synthetic id=0. */
    realNationCount?: number;
    inputOptions?: TurnCommandInputOptions;
    generalActionModules?: TurnCommandEnv['generalActionModules'];
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

    const env = {
        ...buildCommandEnv(options.worldState),
        ...(options.generalActionModules ? { generalActionModules: options.generalActionModules } : {}),
    };
    const scenarioConst = asRecord(options.worldState.config).const;
    const {
        general: generalSpecs,
        nation: nationSpecs,
        generalGroups,
        nationGroups,
    } = await loadTurnCommandSpecs(scenarioConst);
    const generalEntries = buildEntries(env, generalSpecs, {
        foundingAvailable:
            options.realNationCount === undefined
                ? undefined
                : options.realNationCount < resolveMaxNation(options.worldState),
    });
    const nationEntries = buildEntries(env, nationSpecs, {
        currentYear: options.worldState.currentYear,
        currentMonth: options.worldState.currentMonth,
    });
    const currentYearMonth = options.worldState.currentYear * 12 + options.worldState.currentMonth - 1;

    return {
        general: buildGroups(
            projectCommandGroups(generalEntries, generalGroups ?? REF_GENERAL_COMMAND_GROUPS),
            ctx,
            view,
            false,
            env,
            'general',
            currentYearMonth
        ),
        nation: buildGroups(
            projectCommandGroups(nationEntries, nationGroups ?? REF_NATION_COMMAND_GROUPS),
            ctx,
            view,
            true,
            env,
            'nation',
            currentYearMonth
        ),
        inputOptions: options.inputOptions ?? {
            cities: [],
            nations: [],
            nationTargets: {},
            generals: [],
            generalTargets: {},
            crewTypes: [],
            armTypes: [],
            nationTypes: [],
            colors: [],
            items: {},
            recruitment: null,
            amountPresets: {},
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
    const scenarioConst = asRecord(options.worldState.config).const;
    const specs = await loadTurnCommandSpecs(scenarioConst);
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
