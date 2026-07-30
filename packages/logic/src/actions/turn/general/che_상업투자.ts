import type { RandomGenerator } from '@sammo-ts/common';
import { JosaUtil } from '@sammo-ts/common';
import type { City, General, GeneralMeta, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, RequirementKey, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    occupiedCity,
    remainCityCapacity,
    reqGeneralGold,
    reqGeneralRice,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';
import type { TriggerDomesticActionType } from '@sammo-ts/logic/actionModules/types.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolver,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type {
    ActionContextBase,
    ActionContextBuilder,
    ActionContextOptions,
    ActionResolveContext,
} from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { clamp } from 'es-toolkit';

export type DomesticCriticalPick = 'fail' | 'normal' | 'success';

export interface DomesticBaseContext<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    general: General<TriggerState>;
    city: City;
    nation?: Nation | null;
    relYear?: number | undefined;
}

export type DomesticActionContext<TriggerState extends GeneralTriggerState = GeneralTriggerState> =
    GeneralActionResolveContext<TriggerState> & DomesticBaseContext<TriggerState>;

export type DomesticStatKey = 'leadership' | 'strength' | 'intelligence';
export type DomesticCityKey = 'agriculture' | 'commerce' | 'security' | 'defence' | 'wall';
export type DomesticCityMaxKey = 'agricultureMax' | 'commerceMax' | 'securityMax' | 'defenceMax' | 'wallMax';

export interface InvestmentConfig {
    key: string;
    name: string;
    actionKey: TriggerDomesticActionType;
    statKey: DomesticStatKey;
    statExpKey: 'leadership_exp' | 'strength_exp' | 'intel_exp';
    cityKey: DomesticCityKey;
    cityMaxKey: DomesticCityMaxKey;
    frontDebuff: number;
    useCityTrust?: boolean;
    scaleSuccessByTrust?: boolean;
    roundCriticalScore?: boolean;
}

export interface InvestmentEnvironment {
    develCost: number;
    defaultTrust?: number;
    frontDebuff?: number;
    frontStatesWithDebuff?: number[];
    getDomesticExpLevelBonus?: (expLevel: number) => number;
    getCriticalRatio?: (context: DomesticActionContext, statKey: string) => { success: number; fail: number };
    getCriticalScoreMultiplier?: (rng: RandomGenerator, pick: DomesticCriticalPick) => number;
    adjustFrontDebuff?: (context: DomesticActionContext, debuff: number) => number;
    maxStatLevel?: number;
}

export interface CommerceInvestmentResult {
    pick: DomesticCriticalPick;
    score: number;
    appliedScore: number;
    exp: number;
    dedication: number;
    costGold: number;
    costRice: number;
    appliedFrontDebuff: boolean;
}

export interface CommerceInvestmentArgs {}

const DEFAULT_TRUST = 50;
const DEFAULT_FRONT_STATES = [1, 3];
const DEFAULT_CONFIG: InvestmentConfig = {
    key: 'che_상업투자',
    name: '상업 투자',
    actionKey: '상업',
    statKey: 'intelligence',
    statExpKey: 'intel_exp',
    cityKey: 'commerce',
    cityMaxKey: 'commerceMax',
    frontDebuff: 0.5,
};

const getMetaNumber = (meta: Record<string, unknown>, key: string): number | null => {
    const raw = meta[key];
    return typeof raw === 'number' ? raw : null;
};

const randomRange = (rng: RandomGenerator, min: number, max: number): number => min + (max - min) * rng.nextFloat1();

const pickByWeight = (rng: RandomGenerator, weights: Record<DomesticCriticalPick, number>): DomesticCriticalPick => {
    const total = weights.fail + weights.normal + weights.success;
    if (total <= 0) {
        return 'normal';
    }
    let cursor = rng.nextFloat1() * total;
    for (const key of ['fail', 'success', 'normal'] as const) {
        cursor -= weights[key];
        if (cursor <= 0) {
            return key;
        }
    }
    return 'normal';
};

const addMetaNumber = (meta: GeneralMeta, key: string, delta: number): GeneralMeta => {
    const current = getMetaNumber(meta, key) ?? 0;
    return { ...meta, [key]: current + delta };
};

export const updateDomesticCriticalMeta = (
    meta: GeneralMeta,
    pick: DomesticCriticalPick,
    score: number
): GeneralMeta => ({
    ...meta,
    max_domestic_critical: pick === 'success' ? (getMetaNumber(meta, 'max_domestic_critical') ?? 0) + score / 2 : 0,
});

export const buildDomesticContextFromView = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    ctx: ConstraintContext,
    view: StateView
): DomesticBaseContext<TriggerState> | null => {
    const general = view.get({
        kind: 'general',
        id: ctx.actorId,
    }) as General<TriggerState> | null;
    if (!general) {
        return null;
    }
    const cityId = ctx.cityId ?? general.cityId;
    const city = view.get({ kind: 'city', id: cityId }) as City | null;
    if (!city) {
        return null;
    }
    const nationId = ctx.nationId ?? general.nationId;
    const nation =
        nationId !== undefined ? ((view.get({ kind: 'nation', id: nationId }) as Nation | null) ?? null) : null;

    return {
        general,
        city,
        nation,
    };
};

// 상업 투자 결과치를 계산하는 경로를 제공한다.
export class CommandResolver<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private readonly pipeline: GeneralActionPipeline<TriggerState>;
    private readonly env: InvestmentEnvironment;
    private readonly config: InvestmentConfig;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        env: InvestmentEnvironment,
        config: InvestmentConfig = DEFAULT_CONFIG
    ) {
        this.pipeline = new GeneralActionPipeline(modules);
        this.env = env;
        this.config = config;
    }

    getCost(context: DomesticBaseContext<TriggerState>): {
        gold: number;
        rice: number;
    } {
        const baseGold = this.env.develCost;
        const gold = Math.round(this.pipeline.onCalcDomestic(context, this.config.actionKey, 'cost', baseGold));
        return { gold, rice: 0 };
    }

    calcBaseScore(context: DomesticActionContext<TriggerState>, rng: RandomGenerator): number {
        const trust = getMetaNumber(context.city.meta, 'trust') ?? this.env.defaultTrust ?? DEFAULT_TRUST;

        const injuryMultiplier = (100 - context.general.injury) / 100;
        const rawStats = {
            leadership: context.general.stats.leadership * injuryMultiplier,
            strength: context.general.stats.strength * injuryMultiplier,
            intelligence: context.general.stats.intelligence * injuryMultiplier,
        };
        if (this.config.statKey === 'strength') {
            rawStats.strength += Math.round(rawStats.intelligence / 4);
        } else if (this.config.statKey === 'intelligence') {
            rawStats.intelligence += Math.round(rawStats.strength / 4);
        }
        const maxStatLevel = this.env.maxStatLevel ?? 255;
        let score = clamp(rawStats[this.config.statKey], 0, maxStatLevel);
        score = this.pipeline.onCalcStat(context, this.config.statKey, score);

        const expLevel =
            getMetaNumber(context.general.meta, 'explevel') ?? getMetaNumber(context.general.meta, 'expLevel') ?? 0;
        const expBonus = this.env.getDomesticExpLevelBonus?.(expLevel) ?? 1 + expLevel / 500;

        if (this.config.useCityTrust !== false) {
            score *= trust / 100;
        }
        score *= expBonus;
        score *= randomRange(rng, 0.8, 1.2);

        return this.pipeline.onCalcDomestic(context, this.config.actionKey, 'score', score);
    }

    resolve(context: DomesticActionContext<TriggerState>, rng: RandomGenerator): CommerceInvestmentResult {
        const { gold: costGold, rice: costRice } = this.getCost(context);
        const trust = getMetaNumber(context.city.meta, 'trust') ?? this.env.defaultTrust ?? DEFAULT_TRUST;
        let score = clamp(this.calcBaseScore(context, rng), 1, Number.MAX_SAFE_INTEGER);

        const ratio =
            this.env.getCriticalRatio?.(context, this.config.statKey) ??
            (() => {
                const rawStats = {
                    leadership: context.general.stats.leadership,
                    strength: context.general.stats.strength + Math.round(context.general.stats.intelligence / 4),
                    intelligence: context.general.stats.intelligence + Math.round(context.general.stats.strength / 4),
                };
                const maxStatLevel = this.env.maxStatLevel ?? 255;
                const leadership = this.pipeline.onCalcStat(
                    context,
                    'leadership',
                    clamp(rawStats.leadership, 0, maxStatLevel)
                );
                const strength = this.pipeline.onCalcStat(
                    context,
                    'strength',
                    clamp(rawStats.strength, 0, maxStatLevel)
                );
                const intelligence = this.pipeline.onCalcStat(
                    context,
                    'intelligence',
                    clamp(rawStats.intelligence, 0, maxStatLevel)
                );
                const average = (leadership + strength + intelligence) / 3;
                const selected =
                    this.config.statKey === 'leadership'
                        ? leadership
                        : this.config.statKey === 'strength'
                          ? strength
                          : intelligence;
                const value = Math.min(average / Math.max(selected, Number.EPSILON), 1.2);
                return {
                    fail: clamp((value / 1.2) ** 1.4 - 0.3, 0, 0.5),
                    success: clamp((value / 1.2) ** 1.5 - 0.25, 0, 0.5),
                };
            })();
        let successRatio = ratio.success;
        let failRatio = ratio.fail;
        if (this.config.scaleSuccessByTrust !== false && trust < 80) {
            successRatio *= trust / 80;
        }
        successRatio = this.pipeline.onCalcDomestic(context, this.config.actionKey, 'success', successRatio);
        failRatio = this.pipeline.onCalcDomestic(context, this.config.actionKey, 'fail', failRatio);

        successRatio = clamp(successRatio, 0, 1);
        failRatio = clamp(failRatio, 0, 1 - successRatio);
        const normalRatio = 1 - successRatio - failRatio;

        const pick = pickByWeight(rng, {
            fail: failRatio,
            success: successRatio,
            normal: normalRatio,
        });

        const criticalMultiplier =
            this.env.getCriticalScoreMultiplier?.(rng, pick) ??
            (pick === 'success' ? randomRange(rng, 2.2, 3) : pick === 'fail' ? randomRange(rng, 0.2, 0.4) : 1);
        score *= criticalMultiplier;
        if (this.config.roundCriticalScore !== false) {
            score = Math.round(score);
        }

        const rewardScore = score;
        const frontStates = this.env.frontStatesWithDebuff ?? DEFAULT_FRONT_STATES;
        let appliedFrontDebuff = false;
        if (frontStates.includes(context.city.frontState)) {
            const baseDebuff = this.env.frontDebuff ?? this.config.frontDebuff;
            const adjustedDebuff = this.env.adjustFrontDebuff?.(context, baseDebuff) ?? baseDebuff;
            let debuff = adjustedDebuff;
            if (context.nation?.capitalCityId === context.city.id && typeof context.relYear === 'number') {
                const debuffScale = clamp(context.relYear - 5, 0, 20) * 0.05;
                debuff = debuffScale * debuff + (1 - debuffScale);
            }
            score *= debuff;
            appliedFrontDebuff = true;
        }

        const exp = rewardScore * 0.7;
        const dedication = rewardScore;

        return {
            pick,
            score: rewardScore,
            appliedScore: score,
            exp,
            dedication,
            costGold,
            costRice,
            appliedFrontDebuff,
        };
    }
}

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, CommerceInvestmentArgs> {
    readonly key: string;
    private readonly command: CommandResolver<TriggerState>;
    private readonly config: InvestmentConfig;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        env: InvestmentEnvironment,
        config: InvestmentConfig = DEFAULT_CONFIG
    ) {
        this.key = config.key;
        this.command = new CommandResolver(modules, env, config);
        this.config = config;
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: CommerceInvestmentArgs
    ): GeneralActionOutcome<TriggerState> {
        void _args;
        const general = context.general;
        const city = context.city;
        if (!city) {
            throw new Error('Commerce investment requires a city context.');
        }

        const result = this.command.resolve(
            {
                ...context,
                city,
                nation: context.nation ?? null,
                relYear:
                    typeof (context as DomesticActionContext<TriggerState>).relYear === 'number'
                        ? (context as DomesticActionContext<TriggerState>).relYear
                        : undefined,
            },
            context.rng
        );

        // 직접 수정 (Immer Draft)
        // 레거시 city 컬럼은 정수형이라 전선 debuff 뒤의 .5도 DB write 시 정수로 저장된다.
        city[this.config.cityKey] = Math.round(
            clamp(city[this.config.cityKey] + result.appliedScore, 0, city[this.config.cityMaxKey])
        );

        general.gold = Math.max(0, general.gold - result.costGold);
        general.rice = Math.max(0, general.rice - result.costRice);
        general.experience += result.exp;
        general.dedication += result.dedication;

        const metaWithStatExp = addMetaNumber(general.meta, this.config.statExpKey, 1);
        general.meta = updateDomesticCriticalMeta(metaWithStatExp, result.pick, result.score);

        const scoreText = Math.round(result.score).toLocaleString();
        const josaUl = JosaUtil.pick(this.config.name, '을');
        if (result.pick === 'fail') {
            context.addLog(
                `${this.config.name}${josaUl} <span class='ev_failed'>실패</span>하여 <C>${scoreText}</> 상승했습니다.`
            );
        } else if (result.pick === 'success') {
            context.addLog(`${this.config.name}${josaUl} <S>성공</>하여 <C>${scoreText}</> 상승했습니다.`);
        } else {
            context.addLog(`${this.config.name}${josaUl} 하여 <C>${scoreText}</> 상승했습니다.`);
        }
        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: this.config.name });

        return { effects: [] };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, CommerceInvestmentArgs> {
    public readonly key: string;
    public readonly name: string;
    private readonly command: CommandResolver<TriggerState>;
    private readonly resolver: ActionResolver<TriggerState>;
    private readonly config: InvestmentConfig;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        env: InvestmentEnvironment,
        config: InvestmentConfig = DEFAULT_CONFIG
    ) {
        this.key = config.key;
        this.name = config.name;
        this.config = config;
        this.command = new CommandResolver(modules, env, config);
        this.resolver = new ActionResolver(modules, env, config);
    }

    parseArgs(_raw: unknown): CommerceInvestmentArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(ctx: ConstraintContext, _args: CommerceInvestmentArgs): Constraint[] {
        void _args;
        const requirements: RequirementKey[] = [];
        if (ctx.cityId !== undefined) {
            requirements.push({ kind: 'city', id: ctx.cityId });
        }
        if (ctx.nationId !== undefined) {
            requirements.push({ kind: 'nation', id: ctx.nationId });
        }

        const getCost = (context: ConstraintContext, view: StateView): number => {
            const domesticContext = buildDomesticContextFromView<TriggerState>(context, view);
            if (!domesticContext) {
                return 0;
            }
            return this.command.getCost(domesticContext).gold;
        };

        return [
            notBeNeutral(),
            notWanderingNation(),
            occupiedCity(),
            suppliedCity(),
            reqGeneralGold(getCost, requirements),
            reqGeneralRice(() => 0, requirements),
            remainCityCapacity(this.config.cityKey, this.config.name),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: CommerceInvestmentArgs
    ): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder: ActionContextBuilder = (
    base: ActionContextBase,
    options: ActionContextOptions
): ActionResolveContext => ({
    ...base,
    city: base.city!,
    nation: base.nation ?? null,
    ...(typeof options.scenarioMeta?.startYear === 'number'
        ? { relYear: options.world.currentYear - options.scenarioMeta.startYear }
        : {}),
});

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_상업투자',
    category: '내정',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? [], env),
};
