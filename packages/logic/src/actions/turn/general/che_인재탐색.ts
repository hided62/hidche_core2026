import { GAME_TICKS_PER_TURN, JosaUtil, type RandomGenerator } from '@sammo-ts/common';
import type {
    City,
    General,
    GeneralMeta,
    GeneralTriggerState,
    StatBlock,
    TriggerValue,
} from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { reqGeneralGold, reqGeneralRice } from '@sammo-ts/logic/constraints/presets.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralAddEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { buildRecruitmentGeneral } from './recruitment.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { buildWorldSummary, resolveStartYear } from '@sammo-ts/logic/actions/turn/actionContextHelpers.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import {
    buildScenarioGeneralPoolClaimMeta,
    pickUniqueScenarioGeneralPoolCandidates,
    resolveLegacyNpcStatTypeFromFixedStats,
    type ScenarioGeneralPoolCandidate,
} from '@sammo-ts/logic/actions/turn/generalPool.js';
import {
    CENTENNIAL_ALL_STAR_NPC_PROGRESS_MULTIPLIER,
    applyCentennialAllStarTarget,
    initializeCentennialGeneratedNpc,
    readCentennialAllStarPoolTarget,
    resolveCentennialAllStarRules,
    resolveCentennialNpcDexTargetRatio,
    type CentennialAllStarRules,
} from '@sammo-ts/logic/scenario/centennialAllStar.js';

export interface TalentScoutArgs {}

export interface TalentScoutCandidate {
    name: string;
    poolEntryId?: number;
    uniqueName?: string;
    stats?: Partial<StatBlock>;
    dex?: [number, number, number, number, number];
    personality?: string | null;
    affinity?: number | null;
    specialDomestic?: string | null;
    specialWar?: string | null;
    picture?: number | string | null;
    imageServer?: number;
    text?: string | null;
    experience?: number;
    dedication?: number;
    sourceInfo?: Record<string, unknown>;
}

export interface TalentScoutWorldSummary {
    totalGeneralCount: number;
    totalNpcCount: number;
    averageStats?: StatBlock;
    averageDex?: [number, number, number, number, number];
}

export interface TalentScoutResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    currentYear: number;
    currentMonth: number;
    startYear: number;
    retirementYear: number;
    centennialRules: CentennialAllStarRules;
    centennialNpcDexTargetRatio: number;
    worldSummary: TalentScoutWorldSummary;
    generalPool?: ScenarioGeneralPoolCandidate[];
    cityPool?: City[];
    existingGeneralNames: string[];
    createGeneralId: () => number;
    turnTermMinutes: number;
    turnTimeBase: Date;
    turnTimeBaseTick?: number;
    ticksPerSecond: number;
}

export interface TalentScoutEnvironment {
    develCost: number;
    maxGeneral: number;
    defaultNpcGold: number;
    defaultNpcRice: number;
    defaultCrewTypeId: number;
    defaultSpecialDomestic: string | null;
    defaultSpecialWar: string | null;
    minNpcAge?: number;
    maxNpcAge?: number;
    minDeathYears?: number;
    maxDeathYears?: number;
    decorateName?: (name: string, npcState: number) => string;
    pickCandidate?: (context: TalentScoutResolveContext, rng: RandomGenerator) => TalentScoutCandidate | null;
    pickSpawnCityId?: (context: TalentScoutResolveContext, rng: RandomGenerator) => number | null;
    buildStats?: (
        context: TalentScoutResolveContext,
        rng: RandomGenerator,
        candidate: TalentScoutCandidate
    ) => StatBlock;
    npcStatTotal?: number;
    npcStatMin?: number;
    npcStatMax?: number;
    randomGeneralFirstNames?: string[];
    randomGeneralMiddleNames?: string[];
    randomGeneralLastNames?: string[];
    availablePersonalities?: string[];
}

type StatExpKey = 'leadership_exp' | 'strength_exp' | 'intel_exp';

const ACTION_NAME = '인재탐색';
const ACTION_KEY = '인재탐색';
const NPC_TYPE = 3;
const DEFAULT_MIN_AGE = 20;
const DEFAULT_MAX_AGE = 25;
const DEFAULT_DEATH_MIN = 10;
const DEFAULT_DEATH_MAX = 50;

export const normalizeLegacyGeneratedDex = (
    values: readonly [number, number, number, number, number]
): [number, number, number, number, number] =>
    values.map((value) => Math.trunc(value)) as [number, number, number, number, number];

export const resolveLegacySpecialityAge = (retirementYear: number, age: number, divisor: number): number =>
    Math.round((retirementYear - age) / divisor) + age;

const addMetaValue = (
    meta: Record<string, TriggerValue>,
    key: string,
    value: TriggerValue | null | undefined
): void => {
    if (value === null || value === undefined) {
        return;
    }
    meta[key] = value;
};

const addMetaNumber = (meta: GeneralMeta, key: StatExpKey, delta: number): GeneralMeta => {
    const current = typeof meta[key] === 'number' ? (meta[key] as number) : 0;
    return { ...meta, [key]: current + delta };
};

const pickByWeight = <T extends string>(rng: RandomGenerator, weights: Record<T, number>): T => {
    const entries = Object.entries(weights) as Array<[T, number]>;
    const first = entries[0];
    if (!first) {
        throw new Error('Empty weights');
    }
    let total = 0;
    for (const [, weight] of entries) {
        if (weight > 0) {
            total += weight;
        }
    }
    if (total <= 0) {
        return first[0];
    }
    let cursor = rng.nextFloat1() * total;
    for (const [key, weight] of entries) {
        if (weight <= 0) {
            continue;
        }
        cursor -= weight;
        if (cursor <= 0) {
            return key;
        }
    }
    const last = entries[entries.length - 1];
    return last ? last[0] : first[0];
};

const pickStatExpKey = (rng: RandomGenerator, general: General): StatExpKey =>
    pickByWeight(rng, {
        leadership_exp: general.stats.leadership,
        strength_exp: general.stats.strength,
        intel_exp: general.stats.intelligence,
    });

const calcFoundProp = (maxGeneral: number, totalGeneralCount: number, totalNpcCount: number): number => {
    if (maxGeneral <= 0) {
        return 0;
    }
    const current = Math.trunc(totalGeneralCount + totalNpcCount / 2);
    const remainSlot = Math.max(maxGeneral - current, 0);
    const main = Math.pow(remainSlot / maxGeneral, 6);
    const small = 1 / (totalNpcCount / 3 + 1);
    const big = 1 / maxGeneral;
    if (totalNpcCount < 50) {
        return Math.max(main, small);
    }
    return Math.max(main, big);
};

const randomRangeInt = (rng: RandomGenerator, min: number, max: number): number => rng.nextInt(min, max + 1);

type InclusiveRandomGenerator = RandomGenerator & {
    nextIntInclusive?: (maxInclusive: number) => number;
};

const legacyChoiceIndex = (rng: RandomGenerator, length: number): number => {
    if (length <= 0) {
        throw new Error('Empty items');
    }
    const inclusive = rng as InclusiveRandomGenerator;
    return inclusive.nextIntInclusive ? inclusive.nextIntInclusive(length - 1) : rng.nextInt(0, length);
};

const legacyChoice = <T>(rng: RandomGenerator, values: readonly T[]): T =>
    values[legacyChoiceIndex(rng, values.length)]!;

const NPC_NAME_PREFIXES = ['', 'ⓝ', 'ⓝ', 'ⓜ', 'ⓖ', '㉥', 'ⓤ', 'ⓞ'] as const;
const NPC_STATE_NAME_PREFIXES: Readonly<Record<number, string>> = {
    0: '',
    1: 'ⓝ',
    2: 'ⓝ',
    3: 'ⓜ',
    4: 'ⓖ',
    5: '㉥',
    6: 'ⓤ',
    9: 'ⓞ',
};
const STORED_NAME_PREFIXES = new Set(Object.values(NPC_STATE_NAME_PREFIXES).filter(Boolean));

const restoreLegacyStoredName = (general: Pick<General, 'name' | 'npcState'>): string => {
    if (STORED_NAME_PREFIXES.has(general.name[0] ?? '')) {
        return general.name;
    }
    return `${NPC_STATE_NAME_PREFIXES[general.npcState] ?? ''}${general.name}`;
};

const countLegacyNameDuplicates = (names: readonly string[], candidate: string): number =>
    NPC_NAME_PREFIXES.reduce(
        (total, prefix) => total + names.filter((name) => name.startsWith(`${prefix}${candidate}`)).length,
        0
    );

const resolveCandidate = (
    context: TalentScoutResolveContext,
    rng: RandomGenerator,
    env: TalentScoutEnvironment
): TalentScoutCandidate | null => {
    if (env.pickCandidate) {
        return env.pickCandidate(context, rng);
    }
    const pool = context.generalPool ?? [];
    if (context.generalPool === undefined) {
        return null;
    }
    return pickUniqueScenarioGeneralPoolCandidates(rng, pool, 1)[0] ?? null;
};

const resolveSpawnCityId = (
    context: TalentScoutResolveContext,
    rng: RandomGenerator,
    env: TalentScoutEnvironment
): number => {
    if (env.pickSpawnCityId) {
        const picked = env.pickSpawnCityId(context, rng);
        if (picked !== null && picked !== undefined) {
            return picked;
        }
    }
    const pool = context.cityPool ?? [];
    if (pool.length > 0) {
        const idx = legacyChoiceIndex(rng, pool.length);
        return pool[idx]!.id;
    }
    return context.general.cityId;
};

const resolveStats = (
    context: TalentScoutResolveContext,
    rng: RandomGenerator,
    env: TalentScoutEnvironment,
    candidate: TalentScoutCandidate
): StatBlock => {
    if (env.buildStats) {
        return env.buildStats(context, rng, candidate);
    }
    const fallback = context.worldSummary.averageStats ?? context.general.stats;
    return {
        leadership: candidate.stats?.leadership ?? fallback.leadership,
        strength: candidate.stats?.strength ?? fallback.strength,
        intelligence: candidate.stats?.intelligence ?? fallback.intelligence,
    };
};

// 인재탐색 확률과 비용을 계산한다.
export class CommandResolver<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private readonly pipeline: GeneralActionPipeline<TriggerState>;
    private readonly env: TalentScoutEnvironment;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        env: TalentScoutEnvironment
    ) {
        this.pipeline = new GeneralActionPipeline(modules);
        this.env = env;
    }

    getCost(): { gold: number; rice: number } {
        return {
            gold: this.env.develCost,
            rice: 0,
        };
    }

    calcFoundProp(context: TalentScoutResolveContext<TriggerState>): number {
        const base = calcFoundProp(
            this.env.maxGeneral,
            context.worldSummary.totalGeneralCount,
            context.worldSummary.totalNpcCount
        );
        return this.pipeline.onCalcDomestic(context, ACTION_KEY, 'probability', base);
    }

    adjustExperience(context: TalentScoutResolveContext<TriggerState>, value: number): number {
        return this.pipeline.onCalcStat(context, 'experience', value);
    }

    adjustDedication(context: TalentScoutResolveContext<TriggerState>, value: number): number {
        return this.pipeline.onCalcStat(context, 'dedication', value);
    }
}

// 인재탐색 실행 결과를 계산한다.
export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, TalentScoutArgs> {
    readonly key = 'che_인재탐색';
    private readonly env: TalentScoutEnvironment;
    private readonly command: CommandResolver<TriggerState>;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        env: TalentScoutEnvironment
    ) {
        this.env = env;
        this.command = new CommandResolver(modules, env);
    }

    resolve(
        context: TalentScoutResolveContext<TriggerState>,
        _args: TalentScoutArgs
    ): GeneralActionOutcome<TriggerState> {
        void _args;
        const general = context.general;
        const { gold: reqGold, rice: reqRice } = this.command.getCost();
        const prop = this.command.calcFoundProp(context);
        const found = context.rng.nextBool(prop);

        const nextGold = Math.max(0, general.gold - reqGold);
        const nextRice = Math.max(0, general.rice - reqRice);
        const expGain = found ? 200 : 100;
        const dedGain = found ? 300 : 70;

        // 직접 수정 (Immer Draft)
        general.gold = nextGold;
        general.rice = nextRice;
        general.experience += this.command.adjustExperience(context, expGain);
        general.dedication += this.command.adjustDedication(context, dedGain);

        if (!found) {
            const statKey = pickStatExpKey(context.rng, general);
            general.meta = addMetaNumber(general.meta, statKey, 1);
            context.addLog('인재를 찾을 수 없었습니다.', {
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });
            return { effects: [] };
        }

        const age = randomRangeInt(
            context.rng,
            this.env.minNpcAge ?? DEFAULT_MIN_AGE,
            this.env.maxNpcAge ?? DEFAULT_MAX_AGE
        );
        const birthYear = context.currentYear - age;
        const deathYear =
            context.currentYear +
            randomRangeInt(
                context.rng,
                this.env.minDeathYears ?? DEFAULT_DEATH_MIN,
                this.env.maxDeathYears ?? DEFAULT_DEATH_MAX
            );
        const candidate = resolveCandidate(context, context.rng, this.env);
        const centennialTarget =
            candidate?.sourceInfo && candidate.uniqueName
                ? readCentennialAllStarPoolTarget({
                      uniqueName: candidate.uniqueName,
                      name: candidate.name,
                      sourceInfo: candidate.sourceInfo,
                  })
                : null;
        const firstNames = this.env.randomGeneralFirstNames ?? ['가'];
        const middleNames = this.env.randomGeneralMiddleNames ?? [''];
        const lastNames = this.env.randomGeneralLastNames ?? ['가'];
        let generatedName: string | null = null;
        if (!candidate) {
            let duplicateLoopCount = 0;
            while (true) {
                generatedName = `${legacyChoice(context.rng, firstNames)}${legacyChoice(
                    context.rng,
                    middleNames
                )}${legacyChoice(context.rng, lastNames)}`;
                const duplicateCount = countLegacyNameDuplicates(context.existingGeneralNames, generatedName);
                if (duplicateCount === 0) {
                    break;
                }
                if (duplicateLoopCount >= 99 || duplicateCount < 2) {
                    generatedName += duplicateCount + 1;
                    break;
                }
                duplicateLoopCount += 1;
            }
        }
        const newGeneralId = context.createGeneralId();
        const resolvedCandidate: TalentScoutCandidate = candidate ?? { name: generatedName! };
        const affinity = randomRangeInt(context.rng, 1, 150);
        const npcStatTotal = this.env.npcStatTotal ?? 150;
        const npcStatMin = this.env.npcStatMin ?? 10;
        const npcStatMax = this.env.npcStatMax ?? 50;
        let pickType: '무' | '지' | '무지';
        let stats: StatBlock;
        if (candidate?.stats && !centennialTarget) {
            stats = resolveStats(context, context.rng, this.env, resolvedCandidate);
            pickType = resolveLegacyNpcStatTypeFromFixedStats(context.rng, stats);
        } else {
            pickType = pickByWeight(context.rng, { 무: 6, 지: 6, 무지: 3 });
            const mainStat = npcStatMax - randomRangeInt(context.rng, 0, npcStatMin);
            const otherStat = npcStatMin + randomRangeInt(context.rng, 0, Math.trunc(npcStatMin / 2));
            const subStat = npcStatTotal - mainStat - otherStat;
            if (pickType === '무') {
                stats = { leadership: subStat, strength: mainStat, intelligence: otherStat };
            } else if (pickType === '지') {
                stats = { leadership: subStat, strength: otherStat, intelligence: mainStat };
            } else {
                stats = { leadership: otherStat, strength: subStat, intelligence: mainStat };
            }
        }
        const averageDex = context.worldSummary.averageDex ?? [0, 0, 0, 0, 0];
        const dexTotal = averageDex[0] + averageDex[1] + averageDex[2] + averageDex[3];
        let dex: [number, number, number, number, number];
        if (candidate?.dex?.[0] && !centennialTarget) {
            dex = candidate.dex;
        } else if (pickType === '무') {
            const distributions = [
                [(dexTotal * 5) / 8, dexTotal / 8, dexTotal / 8, dexTotal / 8],
                [dexTotal / 8, (dexTotal * 5) / 8, dexTotal / 8, dexTotal / 8],
                [dexTotal / 8, dexTotal / 8, (dexTotal * 5) / 8, dexTotal / 8],
            ] as const;
            const picked = legacyChoice(context.rng, distributions);
            dex = [picked[0], picked[1], picked[2], picked[3], averageDex[4]];
        } else if (pickType === '지') {
            dex = [dexTotal / 8, dexTotal / 8, dexTotal / 8, (dexTotal * 5) / 8, averageDex[4]];
        } else {
            dex = [dexTotal / 4, dexTotal / 4, dexTotal / 4, dexTotal / 4, averageDex[4]];
        }
        // Ref passes the averages into GeneralBuilder::setDex(int ...), so PHP
        // truncates every component before persistence. Core's common integer
        // normalizer rounds instead, which changes exact half-point cases.
        dex = normalizeLegacyGeneratedDex(dex);
        const personality =
            resolvedCandidate.personality ?? legacyChoice(context.rng, this.env.availablePersonalities ?? ['che_안전']);
        const name = this.env.decorateName
            ? this.env.decorateName(resolvedCandidate.name, NPC_TYPE)
            : `ⓜ${resolvedCandidate.name}`;
        const cityId = resolveSpawnCityId(context, context.rng, this.env);
        const turnSecond = randomRangeInt(context.rng, 0, context.turnTermMinutes * 60 - 1);
        const turnFraction = randomRangeInt(context.rng, 0, 999_999);
        const turnTick =
            context.turnTimeBaseTick === undefined
                ? undefined
                : context.turnTimeBaseTick +
                  turnSecond * context.ticksPerSecond +
                  Math.floor((turnFraction * context.ticksPerSecond) / 1_000_000);
        const turnTime = new Date(
            context.turnTimeBase.getTime() + turnSecond * 1_000 + Math.floor(turnFraction / 1_000)
        );
        const killturn =
            (deathYear - context.currentYear) * 12 + randomRangeInt(context.rng, 0, 11) + context.currentMonth - 1;
        const meta: GeneralMeta = {
            killturn,
            npcType: NPC_TYPE,
            npc_org: NPC_TYPE,
            explevel: 0,
            dedlevel: 1,
            crewTypeId: this.env.defaultCrewTypeId,
            affinity,
            birthYear,
            deathYear,
            specage: resolveLegacySpecialityAge(context.retirementYear, age, 12),
            specage2: resolveLegacySpecialityAge(context.retirementYear, age, 6),
            dex1: dex[0],
            dex2: dex[1],
            dex3: dex[2],
            dex4: dex[3],
            dex5: dex[4],
            turnSecond,
            turnFraction,
            ...(candidate && candidate.poolEntryId !== undefined && candidate.uniqueName
                ? buildScenarioGeneralPoolClaimMeta(candidate as ScenarioGeneralPoolCandidate, context.turnTimeBase)
                : {}),
        };
        addMetaValue(meta, 'picture', resolvedCandidate.picture ?? null);
        addMetaValue(meta, 'text', resolvedCandidate.text ?? null);

        let newGeneral = {
            ...buildRecruitmentGeneral<TriggerState>({
                id: newGeneralId,
                name,
                nationId: 0,
                cityId,
                stats,
                officerLevel: 0,
                age,
                npcState: NPC_TYPE,
                gold: this.env.defaultNpcGold,
                rice: this.env.defaultNpcRice,
                experience: resolvedCandidate.experience || age * 100,
                dedication: resolvedCandidate.dedication || age * 100,
                crewTypeId: this.env.defaultCrewTypeId,
                role: {
                    personality,
                    specialDomestic: null,
                    specialWar: null,
                },
                meta,
            }),
            turnTime,
            ...(turnTick === undefined ? {} : { turnTick }),
            bornYear: birthYear,
            deadYear: deathYear,
            affinity,
            imageServer: resolvedCandidate.imageServer ?? 0,
            picture: resolvedCandidate.picture ?? 'default.jpg',
        };
        if (centennialTarget) {
            const initialized = initializeCentennialGeneratedNpc(newGeneral, centennialTarget, context.centennialRules);
            const growth = applyCentennialAllStarTarget(
                { ...newGeneral, ...initialized },
                centennialTarget,
                {
                    startYear: context.startYear,
                    year: context.currentYear,
                    month: context.currentMonth,
                },
                context.centennialRules,
                CENTENNIAL_ALL_STAR_NPC_PROGRESS_MULTIPLIER,
                context.centennialNpcDexTargetRatio
            );
            newGeneral = { ...newGeneral, stats: growth.stats, role: growth.role, meta: growth.meta };
        }

        const recruitVerb = '발견';
        const nameRa = JosaUtil.pick(name, '라');
        const generalName = general.name;
        const generalNameYi = JosaUtil.pick(generalName, '이');
        context.addLog(`<Y>${name}</>${nameRa}는 <C>인재</>를 ${recruitVerb}하였습니다!`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        context.addLog(
            `<Y>${generalName}</>${generalNameYi} <Y>${name}</>${nameRa}는 <C>인재</>를 ${recruitVerb}하였습니다!`,
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.SUMMARY,
                format: LogFormat.MONTH,
            }
        );
        context.addLog(`<Y>${name}</>${nameRa}는 <C>인재</>를 ${recruitVerb}`, {
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });

        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        const statKey = pickStatExpKey(context.rng, general);
        const metaAfter = addMetaNumber(general.meta, statKey, 3);
        const active = typeof metaAfter.inherit_active_action === 'number' ? metaAfter.inherit_active_action : 0;
        metaAfter.inherit_active_action = active + Math.max(Math.sqrt(1 / prop), 1);
        general.meta = metaAfter;

        return {
            effects: [createGeneralAddEffect(newGeneral)],
        };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, TalentScoutArgs, TalentScoutResolveContext<TriggerState>> {
    public readonly key = 'che_인재탐색';
    public readonly name = ACTION_NAME;
    private readonly command: CommandResolver<TriggerState>;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        env: TalentScoutEnvironment
    ) {
        this.command = new CommandResolver(modules, env);
        this.resolver = new ActionResolver(modules, env);
    }

    parseArgs(_raw: unknown): TalentScoutArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: TalentScoutArgs): Constraint[] {
        void _ctx;
        void _args;
        const { gold, rice } = this.command.getCost();
        return [reqGeneralGold(() => gold), reqGeneralRice(() => rice)];
    }

    resolve(
        context: TalentScoutResolveContext<TriggerState>,
        args: TalentScoutArgs
    ): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행에 필요한 월드 요약/생성기를 주입한다.
export const actionContextBuilder: ActionContextBuilder = (base, options) => ({
    ...base,
    currentYear: options.world.currentYear,
    currentMonth: options.world.currentMonth,
    startYear: resolveStartYear(options.world, options.scenarioMeta),
    retirementYear:
        typeof options.scenarioConfig.const.retirementYear === 'number'
            ? options.scenarioConfig.const.retirementYear
            : 80,
    centennialRules: resolveCentennialAllStarRules(options.scenarioConfig),
    centennialNpcDexTargetRatio: resolveCentennialNpcDexTargetRatio(options.scenarioConfig),
    worldSummary: {
        ...buildWorldSummary(options.worldRef),
        averageDex: (() => {
            const generals = options.worldRef?.listGenerals().filter((general) => general.npcState < 4) ?? [];
            if (generals.length === 0) {
                return [0, 0, 0, 0, 0] as [number, number, number, number, number];
            }
            return [1, 2, 3, 4, 5].map(
                (armType) =>
                    generals.reduce((sum, general) => {
                        const value = general.meta[`dex${armType}`];
                        return sum + (typeof value === 'number' ? value : 0);
                    }, 0) / generals.length
            ) as [number, number, number, number, number];
        })(),
    },
    // Legacy CityHelper::getAllCities() is consumed in primary-key order.
    cityPool: [...(options.worldRef?.listCities() ?? [])].sort((left, right) => left.id - right.id),
    // Core keeps the initial scenario's display prefix separate from `name`,
    // while Ref persists it in `general.name`. Reconstruct it before executing
    // AbsGeneralPool::checkDuplicatedCnt semantics; the duplicated ⓝ prefix in
    // GeneralBuilder::$prefixList intentionally counts NPC matches twice.
    existingGeneralNames: options.worldRef?.listGenerals().map(restoreLegacyStoredName) ?? [],
    ...(() => {
        const claimedAt = options.world.lastTurnTime ?? base.general.turnTime;
        const generalPool = options.worldRef?.listGeneralPoolCandidates?.(claimedAt);
        return generalPool === undefined ? {} : { generalPool };
    })(),
    createGeneralId: options.createGeneralId,
    turnTermMinutes: Math.max(1, Math.round(options.world.tickSeconds / 60)),
    // GeneralBuilder::build() derives a new NPC turn from gameStor.turntime,
    // not from the scout's own reserved-turn timestamp.
    turnTimeBase: options.world.lastTurnTime ?? base.general.turnTime,
    turnTimeBaseTick: options.world.lastTurnTick,
    ticksPerSecond: GAME_TICKS_PER_TURN / options.world.tickSeconds,
});

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_인재탐색',
    category: '인사',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? [], env),
};
