import type { RandomGenerator } from '@sammo-ts/common';
import type { GeneralTriggerState, StatBlock, TriggerValue } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    availableStrategicCommand,
    beChief,
    notBeNeutral,
    notOpeningPart,
    occupiedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralAddEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { buildRecruitmentGeneral } from '@sammo-ts/logic/actions/turn/general/recruitment.js';
import { JosaUtil } from '@sammo-ts/common';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import {
    buildAverageNationGeneralCount,
    buildNationSummary,
    resolveStartYear,
} from '@sammo-ts/logic/actions/turn/actionContextHelpers.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';

export interface VolunteerRecruitArgs {}

export interface VolunteerRecruitCandidate {
    name: string;
    stats?: Partial<StatBlock>;
    personality?: string | null;
    affinity?: number | null;
    specialDomestic?: string | null;
    specialWar?: string | null;
    picture?: number | string | null;
    text?: string | null;
}

export interface VolunteerRecruitResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    currentYear: number;
    startYear: number;
    averageNationGeneralCount: number;
    nationAverageStats?: StatBlock;
    nationAverageExperience?: number;
    nationAverageDedication?: number;
    generalPool?: VolunteerRecruitCandidate[];
    createGeneralId: () => number;
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
    const pool = context.generalPool ?? [];
    if (pool.length === 0) {
        return null;
    }
    const idx = rng.nextInt(0, pool.length);
    return pool[idx] ?? null;
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
        modules: Array<GeneralActionModule<TriggerState> | null | undefined>,
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
        modules: Array<GeneralActionModule<TriggerState> | null | undefined>,
        env: VolunteerRecruitEnvironment
    ) {
        this.env = env;
        this.command = new CommandResolver(modules, env);
    }

    resolve(
        context: VolunteerRecruitResolveContext<TriggerState>,
        _args: VolunteerRecruitArgs
    ): GeneralActionOutcome<TriggerState> {
        void _args;
        const general = context.general;
        const nation = context.nation;

        const expGain = 5 * (DEFAULT_PRE_TURN + 1);
        const dedGain = 5 * (DEFAULT_PRE_TURN + 1);

        // 직접 수정 (Immer Draft)
        general.experience += expGain;
        general.dedication += dedGain;

        context.addLog(`${ACTION_NAME} 발동!`);
        context.addLog(`${ACTION_NAME} 발동`, {
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });

        if (nation) {
            const generalName = general.name;
            const generalJosa = JosaUtil.pick(generalName, '이');
            const actionJosa = JosaUtil.pick(ACTION_NAME, '을');
            context.addLog(`<Y>${generalName}</>${generalJosa} <M>${ACTION_NAME}</>${actionJosa} 발동했습니다.`, {
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

        const baseAge = this.env.npcAge ?? DEFAULT_NPC_AGE;
        const deathYears = this.env.npcDeathYears ?? DEFAULT_NPC_DEATH_YEARS;
        const killTurnMin = this.env.killTurnMin ?? DEFAULT_KILLTURN_MIN;
        const killTurnMax = this.env.killTurnMax ?? DEFAULT_KILLTURN_MAX;

        for (let idx = 0; idx < createCount; idx += 1) {
            const newGeneralId = context.createGeneralId();
            const candidate = resolveCandidate(context, context.rng, this.env) ?? { name: `NPC_${newGeneralId}` };
            const name = this.env.decorateName ? this.env.decorateName(candidate.name, NPC_TYPE) : candidate.name;
            const birthYear = context.currentYear - baseAge;
            const deathYear = context.currentYear + deathYears;
            const stats = resolveStats(context, context.rng, this.env, candidate);
            const meta: Record<string, TriggerValue> = {
                npcType: NPC_TYPE,
                crewTypeId: this.env.defaultCrewTypeId,
            };
            addMetaValue(meta, 'affinity', candidate.affinity ?? null);
            addMetaValue(meta, 'picture', candidate.picture ?? null);
            addMetaValue(meta, 'birthYear', birthYear);
            addMetaValue(meta, 'deathYear', deathYear);
            addMetaValue(meta, 'specAge', DEFAULT_SPEC_AGE);
            addMetaValue(meta, 'specAge2', DEFAULT_SPEC_AGE);
            addMetaValue(meta, 'killturn', randomRangeInt(context.rng, killTurnMin, killTurnMax));
            addMetaValue(meta, 'text', candidate.text ?? null);

            const newGeneral = buildRecruitmentGeneral<TriggerState>({
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
                experience: context.nationAverageExperience ?? 0,
                dedication: context.nationAverageDedication ?? 0,
                crewTypeId: this.env.defaultCrewTypeId,
                role: {
                    personality: candidate.personality ?? null,
                    specialDomestic: this.env.defaultSpecialDomestic,
                    specialWar: this.env.defaultSpecialWar,
                },
                meta,
            });
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
        modules: Array<GeneralActionModule<TriggerState> | null | undefined>,
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
    return {
        ...base,
        currentYear: options.world.currentYear,
        startYear: resolveStartYear(options.world, options.scenarioMeta),
        averageNationGeneralCount: buildAverageNationGeneralCount(options.worldRef),
        nationAverageStats: nationSummary.averageStats,
        nationAverageExperience: nationSummary.averageExperience,
        nationAverageDedication: nationSummary.averageDedication,
        createGeneralId: options.createGeneralId,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_의병모집',
    category: '전략',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? [], env),
};
