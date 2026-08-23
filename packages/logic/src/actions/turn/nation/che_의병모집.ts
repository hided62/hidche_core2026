import { GAME_TICKS_PER_TURN, JosaUtil, type RandomGenerator } from '@sammo-ts/common';
import type {
    General,
    GeneralMeta,
    GeneralTriggerState,
    StatBlock,
    TriggerValue,
} from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    availableStrategicCommand,
    beChief,
    notBeNeutral,
    notOpeningPart,
    occupiedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralAddEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { buildRecruitmentGeneral } from '@sammo-ts/logic/actions/turn/general/recruitment.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import {
    buildAverageNationGeneralCount,
    buildNationSummary,
    resolveStartYear,
} from '@sammo-ts/logic/actions/turn/actionContextHelpers.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';
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

export interface VolunteerRecruitArgs {}

export interface VolunteerRecruitCandidate {
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
    sourceInfo?: Record<string, unknown>;
}

export interface VolunteerRecruitResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    currentYear: number;
    currentMonth: number;
    startYear: number;
    centennialRules: CentennialAllStarRules;
    centennialNpcDexTargetRatio: number;
    averageNationGeneralCount: number;
    nationAverageStats?: StatBlock;
    nationAverageExperience?: number;
    nationAverageDedication?: number;
    nationAverageDex?: [number, number, number, number, number];
    friendlyGenerals: Array<General<TriggerState>>;
    generalPool?: ScenarioGeneralPoolCandidate[];
    existingGeneralNames?: string[];
    createGeneralId: () => number;
    turnTermSeconds: number;
    turnTimeBase: Date;
    turnTimeBaseTick?: number;
    ticksPerSecond: number;
}

export interface VolunteerRecruitEnvironment {
    openingPartYear: number;
    initialNationGenLimit: number;
    defaultNpcGold: number;
    defaultNpcRice: number;
    defaultCrewTypeId: number;
    defaultSpecialDomestic: string | null;
    defaultSpecialWar: string | null;
    createCountBase?: number;
    createCountDivisor?: number;
    globalDelayBase?: number;
    npcAge?: number;
    npcDeathYears?: number;
    killTurnMin?: number;
    killTurnMax?: number;
    npcStatTotal?: number;
    npcStatMin?: number;
    npcStatMax?: number;
    randomGeneralFirstNames?: string[];
    randomGeneralMiddleNames?: string[];
    randomGeneralLastNames?: string[];
    availablePersonalities?: string[];
    decorateName?: (name: string, npcState: number) => string;
    pickCandidate?: (context: VolunteerRecruitResolveContext, rng: RandomGenerator) => VolunteerRecruitCandidate | null;
    buildStats?: (
        context: VolunteerRecruitResolveContext,
        rng: RandomGenerator,
        candidate: VolunteerRecruitCandidate
    ) => StatBlock;
}

const ACTION_NAME = '의병모집';
const NPC_TYPE = 4;
const DEFAULT_PRE_TURN = 2;
const DEFAULT_CREATE_BASE = 3;
const DEFAULT_CREATE_DIVISOR = 8;
const DEFAULT_GLOBAL_DELAY = 9;
const DEFAULT_NPC_AGE = 20;
const DEFAULT_NPC_DEATH_YEARS = 10;
const DEFAULT_KILLTURN_MIN = 64;
const DEFAULT_KILLTURN_MAX = 70;
const DEFAULT_SPEC_AGE = 19;
const DEFAULT_NPC_STAT_TOTAL = 150;
const DEFAULT_NPC_STAT_MIN = 10;
const DEFAULT_NPC_STAT_MAX = 75;
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

const readMetaNumber = (meta: Record<string, TriggerValue>, key: string): number | null => {
    const value = meta[key];
    return typeof value === 'number' ? value : null;
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

const pickLegacyRandomNames = (
    rng: RandomGenerator,
    count: number,
    existingNames: readonly string[],
    firstNames: readonly string[],
    middleNames: readonly string[],
    lastNames: readonly string[]
): string[] =>
    Array.from({ length: count }, () => {
        let loopCount = 0;
        while (true) {
            let name = `${legacyChoice(rng, firstNames)}${legacyChoice(rng, middleNames)}${legacyChoice(rng, lastNames)}`;
            const duplicateCount = countLegacyNameDuplicates(existingNames, name);
            if (duplicateCount === 0) {
                return name;
            }
            if (loopCount >= 99 || duplicateCount < 2) {
                name += duplicateCount + 1;
                return name;
            }
            loopCount += 1;
        }
    });

const pickByWeight = <T extends string>(rng: RandomGenerator, weights: Record<T, number>): T => {
    const entries = Object.entries(weights) as Array<[T, number]>;
    const first = entries[0];
    if (!first) {
        throw new Error('Empty weights');
    }
    const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
    let cursor = rng.nextFloat1() * total;
    for (const [key, weight] of entries) {
        cursor -= Math.max(0, weight);
        if (cursor <= 0) {
            return key;
        }
    }
    return entries.at(-1)?.[0] ?? first[0];
};

const buildLegacyRandomStats = (
    rng: RandomGenerator,
    env: VolunteerRecruitEnvironment
): { stats: StatBlock; pickType: '무' | '지' } => {
    const total = env.npcStatTotal ?? DEFAULT_NPC_STAT_TOTAL;
    const min = env.npcStatMin ?? DEFAULT_NPC_STAT_MIN;
    const max = env.npcStatMax ?? DEFAULT_NPC_STAT_MAX;
    const pickType = pickByWeight(rng, { 무: 5, 지: 5 });
    const main = max - randomRangeInt(rng, 0, min);
    const other = min + randomRangeInt(rng, 0, Math.trunc(min / 2));
    const sub = total - main - other;
    return {
        pickType,
        stats:
            pickType === '무'
                ? { leadership: sub, strength: main, intelligence: other }
                : { leadership: sub, strength: other, intelligence: main },
    };
};

const resolveRelYear = (ctx: ConstraintContext): number => {
    const relYear = ctx.env.relYear;
    if (typeof relYear === 'number') {
        return relYear;
    }
    const year = ctx.env.year;
    const currentYear = ctx.env.currentYear;
    const startYear = ctx.env.startYear;
    if (typeof currentYear === 'number' && typeof startYear === 'number') {
        return currentYear - startYear;
    }
    if (typeof year === 'number' && typeof startYear === 'number') {
        return year - startYear;
    }
    return 0;
};

const resolveCandidate = (
    context: VolunteerRecruitResolveContext,
    rng: RandomGenerator,
    env: VolunteerRecruitEnvironment
): VolunteerRecruitCandidate | null => {
    if (env.pickCandidate) {
        return env.pickCandidate(context, rng);
    }
    if (context.generalPool === undefined) {
        return null;
    }
    return pickUniqueScenarioGeneralPoolCandidates(rng, context.generalPool, 1)[0] ?? null;
};

const resolveStats = (
    context: VolunteerRecruitResolveContext,
    rng: RandomGenerator,
    env: VolunteerRecruitEnvironment,
    candidate: VolunteerRecruitCandidate
): StatBlock => {
    if (env.buildStats) {
        return env.buildStats(context, rng, candidate);
    }
    const fallback = context.nationAverageStats ?? context.general.stats;
    return {
        leadership: candidate.stats?.leadership ?? fallback.leadership,
        strength: candidate.stats?.strength ?? fallback.strength,
        intelligence: candidate.stats?.intelligence ?? fallback.intelligence,
    };
};

// 의병모집 쿨타임/인원 계산을 제공한다.
export class CommandResolver<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private readonly pipeline: GeneralActionPipeline<TriggerState>;
    private readonly env: VolunteerRecruitEnvironment;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        env: VolunteerRecruitEnvironment
    ) {
        this.pipeline = new GeneralActionPipeline(modules);
        this.env = env;
    }

    getPostDelay(context: VolunteerRecruitResolveContext<TriggerState>, gennum: number): number {
        const fitted = Math.max(gennum, this.env.initialNationGenLimit);
        const base = Math.round(Math.sqrt(fitted * 10) * 10);
        return Math.round(this.pipeline.onCalcStrategic(context, ACTION_NAME, 'delay', base));
    }

    getGlobalDelay(context: VolunteerRecruitResolveContext<TriggerState>): number {
        const base = this.env.globalDelayBase ?? DEFAULT_GLOBAL_DELAY;
        return Math.round(this.pipeline.onCalcStrategic(context, ACTION_NAME, 'globalDelay', base));
    }

    getCreateCount(avgNationGenCount: number): number {
        const base = this.env.createCountBase ?? DEFAULT_CREATE_BASE;
        const divisor = this.env.createCountDivisor ?? DEFAULT_CREATE_DIVISOR;
        return base + Math.round(avgNationGenCount / divisor);
    }
}

// 의병모집 실행 결과를 계산한다.
export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, VolunteerRecruitArgs> {
    readonly key = 'che_의병모집';
    private readonly env: VolunteerRecruitEnvironment;
    private readonly command: CommandResolver<TriggerState>;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        env: VolunteerRecruitEnvironment
    ) {
        this.env = env;
        this.command = new CommandResolver(modules, env);
    }

    getPostReqTurn(context: VolunteerRecruitResolveContext<TriggerState>): number {
        const value = context.nation ? readMetaNumber(context.nation.meta, 'gennum') : null;
        return this.command.getPostDelay(context, value ?? 0);
    }

    resolve(
        context: VolunteerRecruitResolveContext<TriggerState>,
        _args: VolunteerRecruitArgs
    ): GeneralActionOutcome<TriggerState> {
        void _args;
        const general = context.general;
        const nation = context.nation;
        const generalName = general.name;
        const generalJosa = JosaUtil.pick(generalName, '이');
        const actionJosa = JosaUtil.pick(ACTION_NAME, '을');
        const broadcastMessage = `<Y>${generalName}</>${generalJosa} <M>${ACTION_NAME}</>${actionJosa} 발동하였습니다.`;

        const expGain = 5 * (DEFAULT_PRE_TURN + 1);
        const dedGain = 5 * (DEFAULT_PRE_TURN + 1);

        // 직접 수정 (Immer Draft)
        general.experience += expGain;
        general.dedication += dedGain;

        const actionName = ACTION_NAME;
        context.addLog(`${actionName} 발동!`);
        context.addLog(`${actionName} 발동`, {
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });

        if (nation) {
            context.addLog(`<Y>${generalName}</>${generalJosa} <M>${actionName}</>${actionJosa} 발동`, {
                scope: LogScope.NATION,
                category: LogCategory.HISTORY,
                nationId: nation.id,
                format: LogFormat.YEAR_MONTH,
            });
        }

        const avgNationGen = Number.isFinite(context.averageNationGeneralCount) ? context.averageNationGeneralCount : 0;
        const createCount = Math.max(0, this.command.getCreateCount(avgNationGen));
        const gennumValue = nation ? readMetaNumber(nation.meta, 'gennum') : null;
        const currentGennum = gennumValue ?? 0;
        const nextGennum = currentGennum + createCount;
        const globalDelay = this.command.getGlobalDelay(context);

        if (nation) {
            nation.meta = {
                ...(nation.meta as object),
                gennum: nextGennum,
                strategic_cmd_limit: globalDelay,
            };
        }

        const effects: Array<GeneralActionEffect<TriggerState>> = [];
        for (const target of context.friendlyGenerals) {
            if (target.id === general.id) {
                continue;
            }
            effects.push(
                createLogEffect(broadcastMessage, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: target.id,
                    format: LogFormat.PLAIN,
                })
            );
        }

        const baseAge = this.env.npcAge ?? DEFAULT_NPC_AGE;
        const deathYears = this.env.npcDeathYears ?? DEFAULT_NPC_DEATH_YEARS;
        const killTurnMin = this.env.killTurnMin ?? DEFAULT_KILLTURN_MIN;
        const killTurnMax = this.env.killTurnMax ?? DEFAULT_KILLTURN_MAX;
        const firstNames = this.env.randomGeneralFirstNames ?? ['가'];
        const middleNames = this.env.randomGeneralMiddleNames ?? [''];
        const lastNames = this.env.randomGeneralLastNames ?? ['가'];
        const candidates: VolunteerRecruitCandidate[] = this.env.pickCandidate
            ? Array.from(
                  { length: createCount },
                  () =>
                      resolveCandidate(context, context.rng, this.env) ?? {
                          name: pickLegacyRandomNames(
                              context.rng,
                              1,
                              context.existingGeneralNames ?? [],
                              firstNames,
                              middleNames,
                              lastNames
                          )[0]!,
                      }
              )
            : context.generalPool === undefined
              ? pickLegacyRandomNames(
                    context.rng,
                    createCount,
                    context.existingGeneralNames ?? [],
                    firstNames,
                    middleNames,
                    lastNames
                ).map((name) => ({ name }))
              : pickUniqueScenarioGeneralPoolCandidates(context.rng, context.generalPool, createCount);

        for (const candidate of candidates) {
            const centennialTarget =
                candidate.sourceInfo && candidate.uniqueName
                    ? readCentennialAllStarPoolTarget({
                          uniqueName: candidate.uniqueName,
                          name: candidate.name,
                          sourceInfo: candidate.sourceInfo,
                      })
                    : null;
            const newGeneralId = context.createGeneralId();
            const name = this.env.decorateName ? this.env.decorateName(candidate.name, NPC_TYPE) : `ⓖ${candidate.name}`;
            const birthYear = context.currentYear - baseAge;
            const deathYear = context.currentYear + deathYears;
            const killturn = randomRangeInt(context.rng, killTurnMin, killTurnMax);
            const affinity = candidate.affinity ?? randomRangeInt(context.rng, 1, 150);
            let pickType: '무' | '지' | '무지';
            let stats: StatBlock;
            if (candidate.stats && !centennialTarget) {
                stats = resolveStats(context, context.rng, this.env, candidate);
                pickType = resolveLegacyNpcStatTypeFromFixedStats(context.rng, stats);
            } else {
                const generated = buildLegacyRandomStats(context.rng, this.env);
                pickType = generated.pickType;
                stats = generated.stats;
            }
            const averageDex = context.nationAverageDex ?? [0, 0, 0, 0, 0];
            const dexTotal = averageDex[0] + averageDex[1] + averageDex[2] + averageDex[3];
            let dex: [number, number, number, number, number];
            if (candidate.dex?.[0] && !centennialTarget) {
                dex = candidate.dex;
            } else {
                const rawDex: [number, number, number, number] =
                    pickType === '무'
                        ? legacyChoice(context.rng, [
                              [(dexTotal * 5) / 8, dexTotal / 8, dexTotal / 8, dexTotal / 8],
                              [dexTotal / 8, (dexTotal * 5) / 8, dexTotal / 8, dexTotal / 8],
                              [dexTotal / 8, dexTotal / 8, (dexTotal * 5) / 8, dexTotal / 8],
                          ])
                        : pickType === '지'
                          ? [dexTotal / 8, dexTotal / 8, dexTotal / 8, (dexTotal * 5) / 8]
                          : [dexTotal / 4, dexTotal / 4, dexTotal / 4, dexTotal / 4];
                dex = [
                    Math.trunc(rawDex[0]),
                    Math.trunc(rawDex[1]),
                    Math.trunc(rawDex[2]),
                    Math.trunc(rawDex[3]),
                    Math.trunc(averageDex[4]),
                ];
            }
            const personality =
                candidate.personality ?? legacyChoice(context.rng, this.env.availablePersonalities ?? ['che_안전']);
            const turnSecond = randomRangeInt(context.rng, 0, context.turnTermSeconds - 1);
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
            const meta: GeneralMeta = {
                killturn,
                npcType: NPC_TYPE,
                crewTypeId: this.env.defaultCrewTypeId,
                dex1: dex[0],
                dex2: dex[1],
                dex3: dex[2],
                dex4: dex[3],
                dex5: dex[4],
                turnSecond,
                turnFraction,
                ...(candidate.poolEntryId !== undefined && candidate.uniqueName
                    ? buildScenarioGeneralPoolClaimMeta(candidate as ScenarioGeneralPoolCandidate, context.turnTimeBase)
                    : {}),
            };
            addMetaValue(meta, 'affinity', affinity);
            addMetaValue(meta, 'picture', candidate.picture ?? null);
            addMetaValue(meta, 'birthYear', birthYear);
            addMetaValue(meta, 'deathYear', deathYear);
            addMetaValue(meta, 'specage', DEFAULT_SPEC_AGE);
            addMetaValue(meta, 'specage2', DEFAULT_SPEC_AGE);
            addMetaValue(meta, 'text', candidate.text ?? null);

            const averageExperience = Math.trunc(context.nationAverageExperience ?? 0);
            const averageDedication = Math.trunc(context.nationAverageDedication ?? 0);

            let newGeneral = {
                ...buildRecruitmentGeneral<TriggerState>({
                    id: newGeneralId,
                    name,
                    nationId: context.general.nationId,
                    cityId: context.general.cityId,
                    stats,
                    officerLevel: 1,
                    age: baseAge,
                    npcState: NPC_TYPE,
                    gold: this.env.defaultNpcGold,
                    rice: this.env.defaultNpcRice,
                    // GeneralBuilder::build() uses PHP's falsy `?: age * 100`
                    // after setExpDed(), including when a nation's averages are 0.
                    experience: averageExperience || baseAge * 100,
                    dedication: averageDedication || baseAge * 100,
                    crewTypeId: this.env.defaultCrewTypeId,
                    role: {
                        personality,
                        specialDomestic: this.env.defaultSpecialDomestic,
                        specialWar: this.env.defaultSpecialWar,
                    },
                    meta,
                }),
                turnTime,
                ...(turnTick === undefined ? {} : { turnTick }),
                bornYear: birthYear,
                deadYear: deathYear,
                imageServer: candidate.imageServer ?? 0,
                picture: candidate.picture ?? 'default.jpg',
            };
            if (centennialTarget) {
                const initialized = initializeCentennialGeneratedNpc(
                    newGeneral,
                    centennialTarget,
                    context.centennialRules
                );
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
            effects.push(createGeneralAddEffect(newGeneral));
        }

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, VolunteerRecruitArgs, VolunteerRecruitResolveContext<TriggerState>> {
    public readonly key = 'che_의병모집';
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;
    private readonly env: VolunteerRecruitEnvironment;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        env: VolunteerRecruitEnvironment
    ) {
        this.env = env;
        this.resolver = new ActionResolver(modules, env);
    }

    parseArgs(_raw: unknown): VolunteerRecruitArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(ctx: ConstraintContext, _args: VolunteerRecruitArgs): Constraint[] {
        void _args;
        const relYear = resolveRelYear(ctx);
        return [
            beChief(),
            notBeNeutral(),
            occupiedCity(),
            availableStrategicCommand(),
            notOpeningPart(relYear, this.env.openingPartYear),
        ];
    }

    getPreReqTurn(): number {
        return DEFAULT_PRE_TURN;
    }

    getPostReqTurn(context: VolunteerRecruitResolveContext<TriggerState>): number {
        return this.resolver.getPostReqTurn(context);
    }

    resolve(
        context: VolunteerRecruitResolveContext<TriggerState>,
        args: VolunteerRecruitArgs
    ): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행에 필요한 국가 평균 정보를 구성한다.
export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const nationSummary = buildNationSummary(options.worldRef, base.general.nationId);
    const friendlyGenerals =
        options.worldRef?.listGenerals().filter((general) => general.nationId === base.general.nationId) ?? [];
    return {
        ...base,
        currentYear: options.world.currentYear,
        currentMonth: options.world.currentMonth,
        startYear: resolveStartYear(options.world, options.scenarioMeta),
        centennialRules: resolveCentennialAllStarRules(options.scenarioConfig),
        centennialNpcDexTargetRatio: resolveCentennialNpcDexTargetRatio(options.scenarioConfig),
        averageNationGeneralCount: buildAverageNationGeneralCount(options.worldRef),
        nationAverageStats: nationSummary.averageStats,
        nationAverageExperience: nationSummary.averageExperience,
        nationAverageDedication: nationSummary.averageDedication,
        nationAverageDex: nationSummary.averageDex,
        friendlyGenerals,
        existingGeneralNames: options.worldRef?.listGenerals().map(restoreLegacyStoredName) ?? [],
        ...(() => {
            const claimedAt = options.world.lastTurnTime ?? base.general.turnTime;
            const generalPool = options.worldRef?.listGeneralPoolCandidates?.(claimedAt);
            return generalPool === undefined ? {} : { generalPool };
        })(),
        createGeneralId: options.createGeneralId,
        turnTermSeconds: Math.max(1, Math.round(options.world.tickSeconds)),
        turnTimeBase: options.world.lastTurnTime ?? base.general.turnTime,
        turnTimeBaseTick: options.world.lastTurnTick,
        ticksPerSecond: GAME_TICKS_PER_TURN / options.world.tickSeconds,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_의병모집',
    category: '전략',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? [], env),
};
