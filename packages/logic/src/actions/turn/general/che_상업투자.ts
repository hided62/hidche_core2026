import type { RandomGenerator } from '@sammo-ts/common';
import type { City, General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
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
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolver,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { clamp } from 'es-toolkit';

export type DomesticCriticalPick = 'fail' | 'normal' | 'success';

export interface DomesticActionContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionContext<TriggerState> {
    general: General<TriggerState>;
    city: City;
    nation?: Nation | null;
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
}

export interface CommerceInvestmentResult {
    pick: DomesticCriticalPick;
    score: number;
    exp: number;
    dedication: number;
    costGold: number;
    costRice: number;
    appliedFrontDebuff: boolean;
}

export interface CommerceInvestmentArgs {}

const DEFAULT_TRUST = 50;
const DEFAULT_FRONT_DEBUFF = 0.5;
const DEFAULT_FRONT_STATES = [1, 3];
const ACTION_NAME = '상업 투자';
const CITY_KEY = 'commerce';
const STAT_EXP_KEY = 'intel_exp';

const getMetaNumber = (meta: Record<string, unknown>, key: string): number | null => {
    const raw = meta[key];
    return typeof raw === 'number' ? raw : null;
};

const randomRange = (rng: RandomGenerator, min: number, max: number): number => min + (max - min) * rng.nextFloat();

const pickByWeight = (rng: RandomGenerator, weights: Record<DomesticCriticalPick, number>): DomesticCriticalPick => {
    const total = weights.fail + weights.normal + weights.success;
    if (total <= 0) {
        return 'normal';
    }
    let cursor = rng.nextFloat() * total;
    for (const key of ['fail', 'normal', 'success'] as const) {
        cursor -= weights[key];
        if (cursor <= 0) {
            return key;
        }
    }
    return 'normal';
};

const addMetaNumber = (meta: Record<string, unknown>, key: string, delta: number): Record<string, unknown> => {
    const current = getMetaNumber(meta, key) ?? 0;
    return { ...meta, [key]: current + delta };
};

const buildDomesticContextFromView = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    ctx: ConstraintContext,
    view: StateView
): DomesticActionContext<TriggerState> | null => {
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
    private readonly actionKey = '상업';
    private readonly statKey = 'intelligence';

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: InvestmentEnvironment) {
        this.pipeline = new GeneralActionPipeline(modules);
        this.env = env;
    }

    getCost(context: DomesticActionContext<TriggerState>): {
        gold: number;
        rice: number;
    } {
        const baseGold = this.env.develCost;
        const gold = Math.round(this.pipeline.onCalcDomestic(context, this.actionKey, 'cost', baseGold));
        return { gold, rice: 0 };
    }

    calcBaseScore(context: DomesticActionContext<TriggerState>, rng: RandomGenerator): number {
        const trust = getMetaNumber(context.city.meta, 'trust') ?? this.env.defaultTrust ?? DEFAULT_TRUST;

        let score = this.pipeline.onCalcStat(context, this.statKey, context.general.stats.intelligence);

        const expLevel =
            getMetaNumber(context.general.meta, 'explevel') ?? getMetaNumber(context.general.meta, 'expLevel') ?? 0;
        const expBonus = this.env.getDomesticExpLevelBonus?.(expLevel) ?? 1;

        score *= trust / 100;
        score *= expBonus;
        score *= randomRange(rng, 0.8, 1.2);

        return this.pipeline.onCalcDomestic(context, this.actionKey, 'score', score);
    }

    resolve(context: DomesticActionContext<TriggerState>, rng: RandomGenerator): CommerceInvestmentResult {
        const { gold: costGold, rice: costRice } = this.getCost(context);
        const trust = getMetaNumber(context.city.meta, 'trust') ?? this.env.defaultTrust ?? DEFAULT_TRUST;
        let score = clamp(this.calcBaseScore(context, rng), 1, Number.MAX_SAFE_INTEGER);

        const ratio = this.env.getCriticalRatio?.(context, this.statKey) ?? {
            success: 0,
            fail: 0,
        };
        let successRatio = ratio.success;
        let failRatio = ratio.fail;
        if (trust < 80) {
            successRatio *= trust / 80;
        }
        successRatio = this.pipeline.onCalcDomestic(context, this.actionKey, 'success', successRatio);
        failRatio = this.pipeline.onCalcDomestic(context, this.actionKey, 'fail', failRatio);

        successRatio = clamp(successRatio, 0, 1);
        failRatio = clamp(failRatio, 0, 1 - successRatio);
        const normalRatio = 1 - successRatio - failRatio;

        const pick = pickByWeight(rng, {
            fail: failRatio,
            success: successRatio,
            normal: normalRatio,
        });

        const criticalMultiplier = this.env.getCriticalScoreMultiplier?.(rng, pick) ?? 1;
        score = Math.round(score * criticalMultiplier);

        const frontStates = this.env.frontStatesWithDebuff ?? DEFAULT_FRONT_STATES;
        let appliedFrontDebuff = false;
        if (frontStates.includes(context.city.frontState)) {
            const baseDebuff = this.env.frontDebuff ?? DEFAULT_FRONT_DEBUFF;
            const adjustedDebuff = this.env.adjustFrontDebuff?.(context, baseDebuff) ?? baseDebuff;
            score *= adjustedDebuff;
            appliedFrontDebuff = true;
        }

        const exp = score * 0.7;
        const dedication = score * 1.0;

        return {
            pick,
            score,
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
    readonly key = 'che_상업투자';
    private readonly command: CommandResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: InvestmentEnvironment) {
        this.command = new CommandResolver(modules, env);
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
            },
            context.rng
        );

        // 직접 수정 (Immer Draft)
        city.commerce = clamp(city.commerce + result.score, 0, city.commerceMax);

        general.gold = Math.max(0, general.gold - result.costGold);
        general.rice = Math.max(0, general.rice - result.costRice);
        general.experience += result.exp;
        general.dedication += result.dedication;

        const metaWithStatExp = addMetaNumber(general.meta, STAT_EXP_KEY, 1);
        general.meta =
            result.pick === 'success'
                ? { ...metaWithStatExp, max_domestic_critical: result.score }
                : { ...metaWithStatExp, max_domestic_critical: 0 };

        const pickLabel = result.pick === 'success' ? '성공' : result.pick === 'fail' ? '실패' : '완료';
        const logMessage = `${ACTION_NAME} ${pickLabel}: +${Math.round(result.score)}`;
        context.addLog(logMessage);

        return { effects: [] };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, CommerceInvestmentArgs> {
    public readonly key = 'che_상업투자';
    public readonly name = ACTION_NAME;
    private readonly command: CommandResolver<TriggerState>;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: InvestmentEnvironment) {
        this.command = new CommandResolver(modules, env);
        this.resolver = new ActionResolver(modules, env);
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
            remainCityCapacity(CITY_KEY, ACTION_NAME),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: CommerceInvestmentArgs
    ): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_상업투자',
    category: '내정',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? [], env),
};
