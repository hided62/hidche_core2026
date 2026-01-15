import type { RandomGenerator } from '@sammo-ts/common';
import type { City, General, GeneralTriggerState, StatBlock, TriggerValue } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { reqGeneralGold, reqGeneralRice } from '@sammo-ts/logic/constraints/presets.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralAddEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { buildRecruitmentGeneral } from './recruitment.js';
import { JosaUtil } from '@sammo-ts/common';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { buildWorldSummary } from '@sammo-ts/logic/actions/turn/actionContextHelpers.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface TalentScoutArgs {}

export interface TalentScoutCandidate {
    name: string;
    stats?: Partial<StatBlock>;
    personality?: string | null;
    affinity?: number | null;
    specialDomestic?: string | null;
    specialWar?: string | null;
    picture?: number | string | null;
    text?: string | null;
}

export interface TalentScoutWorldSummary {
    totalGeneralCount: number;
    totalNpcCount: number;
    averageStats?: StatBlock;
}

export interface TalentScoutResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    currentYear: number;
    worldSummary: TalentScoutWorldSummary;
    generalPool?: TalentScoutCandidate[];
    cityPool?: City[];
    createGeneralId: () => number;
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
}

type StatExpKey = 'leadership_exp' | 'strength_exp' | 'intel_exp';

const ACTION_NAME = '인재탐색';
const ACTION_KEY = '인재탐색';
const NPC_TYPE = 3;
const DEFAULT_MIN_AGE = 20;
const DEFAULT_MAX_AGE = 25;
const DEFAULT_DEATH_MIN = 10;
const DEFAULT_DEATH_MAX = 50;

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

const addMetaNumber = (
    meta: Record<string, TriggerValue>,
    key: StatExpKey,
    delta: number
): Record<string, TriggerValue> => {
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
    let cursor = rng.nextFloat() * total;
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
    const current = totalGeneralCount + totalNpcCount / 2;
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

const resolveCandidate = (
    context: TalentScoutResolveContext,
    rng: RandomGenerator,
    env: TalentScoutEnvironment
): TalentScoutCandidate | null => {
    if (env.pickCandidate) {
        return env.pickCandidate(context, rng);
    }
    const pool = context.generalPool ?? [];
    if (pool.length === 0) {
        return null;
    }
    const idx = rng.nextInt(0, pool.length);
    return pool[idx] ?? null;
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
        const idx = rng.nextInt(0, pool.length);
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

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: TalentScoutEnvironment) {
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
}

// 인재탐색 실행 결과를 계산한다.
export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, TalentScoutArgs> {
    readonly key = 'che_인재탐색';
    private readonly env: TalentScoutEnvironment;
    private readonly command: CommandResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: TalentScoutEnvironment) {
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

        const statKey = pickStatExpKey(context.rng, general);
        const metaAfter = found ? addMetaNumber(general.meta, statKey, 3) : addMetaNumber(general.meta, statKey, 1);

        const nextGold = Math.max(0, general.gold - reqGold);
        const nextRice = Math.max(0, general.rice - reqRice);
        const expGain = found ? 200 : 100;
        const dedGain = found ? 300 : 70;

        // 직접 수정 (Immer Draft)
        general.gold = nextGold;
        general.rice = nextRice;
        general.experience += expGain;
        general.dedication += dedGain;
        general.meta = metaAfter;

        if (!found) {
            context.addLog('인재를 찾을 수 없었습니다.', {
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            return { effects: [] };
        }

        const candidate = resolveCandidate(context, context.rng, this.env);
        const newGeneralId = context.createGeneralId();
        const resolvedCandidate: TalentScoutCandidate = candidate ?? { name: `NPC_${newGeneralId}` };

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
        const stats = resolveStats(context, context.rng, this.env, resolvedCandidate);
        const name = this.env.decorateName
            ? this.env.decorateName(resolvedCandidate.name, NPC_TYPE)
            : resolvedCandidate.name;
        const meta: Record<string, TriggerValue> = {
            npcType: NPC_TYPE,
            crewTypeId: this.env.defaultCrewTypeId,
        };
        addMetaValue(meta, 'affinity', resolvedCandidate.affinity ?? null);
        addMetaValue(meta, 'picture', resolvedCandidate.picture ?? null);
        addMetaValue(meta, 'birthYear', birthYear);
        addMetaValue(meta, 'deathYear', deathYear);
        addMetaValue(meta, 'text', resolvedCandidate.text ?? null);

        const newGeneral = buildRecruitmentGeneral<TriggerState>({
            id: newGeneralId,
            name,
            nationId: 0,
            cityId: resolveSpawnCityId(context, context.rng, this.env),
            stats,
            officerLevel: 0,
            age,
            npcState: NPC_TYPE,
            gold: this.env.defaultNpcGold,
            rice: this.env.defaultNpcRice,
            experience: 0,
            dedication: 0,
            crewTypeId: this.env.defaultCrewTypeId,
            role: {
                personality: resolvedCandidate.personality ?? null,
                specialDomestic: this.env.defaultSpecialDomestic,
                specialWar: this.env.defaultSpecialWar,
            },
            meta,
        });

        const nameObjJosa = JosaUtil.pick(name, '을');
        const nameSubjJosa = JosaUtil.pick(name, '이');
        context.addLog(`인재 <Y>${name}</>${nameObjJosa} 발견했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        context.addLog(`인재 <Y>${name}</>${nameSubjJosa} 등장했습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.SUMMARY,
            format: LogFormat.MONTH,
        });
        context.addLog(`인재 <Y>${name}</>${nameObjJosa} 발견했습니다.`, {
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });

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

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: TalentScoutEnvironment) {
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
    worldSummary: buildWorldSummary(options.worldRef),
    createGeneralId: options.createGeneralId,
});

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_인재탐색',
    category: '인사',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? [], env),
};
