import type { RandomGenerator } from '@sammo-ts/common';
import type {
    City,
    General,
    GeneralTriggerState,
    Nation,
} from '../../domain/entities.js';
import type { GeneralActionContext } from '../../triggers/general.js';
import {
    GeneralActionPipeline,
    type GeneralActionModule,
} from '../../triggers/general-action.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolver,
    GeneralActionResolveContext,
    GeneralActionEffect,
} from '../engine.js';
import {
    createCityPatchEffect,
    createGeneralPatchEffect,
    createLogEffect,
} from '../engine.js';

export type DomesticCriticalPick = 'fail' | 'normal' | 'success';

export interface DomesticActionContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
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
    getCriticalRatio?: (
        context: DomesticActionContext,
        statKey: string
    ) => { success: number; fail: number };
    getCriticalScoreMultiplier?: (
        rng: RandomGenerator,
        pick: DomesticCriticalPick
    ) => number;
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

const DEFAULT_TRUST = 50;
const DEFAULT_FRONT_DEBUFF = 0.5;
const DEFAULT_FRONT_STATES = [1, 3];
const ACTION_NAME = '상업 투자';
const CITY_KEY = 'commerce';
const STAT_EXP_KEY = 'intel_exp';

const getMetaNumber = (
    meta: Record<string, unknown>,
    key: string
): number | null => {
    const raw = meta[key];
    return typeof raw === 'number' ? raw : null;
};

const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max);

const randomRange = (rng: RandomGenerator, min: number, max: number): number =>
    min + (max - min) * rng.nextFloat();

const pickByWeight = (
    rng: RandomGenerator,
    weights: Record<DomesticCriticalPick, number>
): DomesticCriticalPick => {
    const total =
        weights.fail + weights.normal + weights.success;
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

const addMetaNumber = (
    meta: Record<string, unknown>,
    key: string,
    delta: number
): Record<string, unknown> => {
    const current = getMetaNumber(meta, key) ?? 0;
    return { ...meta, [key]: current + delta };
};

// 상업 투자 결과치를 계산하는 경로를 제공한다.
export class CommandResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    private readonly pipeline: GeneralActionPipeline<TriggerState>;
    private readonly env: InvestmentEnvironment;
    private readonly actionKey = '상업';
    private readonly statKey = 'intelligence';

    constructor(
        modules: Array<GeneralActionModule<TriggerState> | null | undefined>,
        env: InvestmentEnvironment
    ) {
        this.pipeline = new GeneralActionPipeline(modules);
        this.env = env;
    }

    getCost(context: DomesticActionContext<TriggerState>): {
        gold: number;
        rice: number;
    } {
        const baseGold = this.env.develCost;
        const gold = Math.round(
            this.pipeline.onCalcDomestic(
                context,
                this.actionKey,
                'cost',
                baseGold
            )
        );
        return { gold, rice: 0 };
    }

    calcBaseScore(
        context: DomesticActionContext<TriggerState>,
        rng: RandomGenerator
    ): number {
        const trust =
            getMetaNumber(context.city.meta, 'trust') ??
            this.env.defaultTrust ??
            DEFAULT_TRUST;

        let score = this.pipeline.onCalcStat(
            context,
            this.statKey,
            context.general.stats.intelligence
        );

        const expLevel =
            getMetaNumber(context.general.meta, 'explevel') ??
            getMetaNumber(context.general.meta, 'expLevel') ??
            0;
        const expBonus =
            this.env.getDomesticExpLevelBonus?.(expLevel) ?? 1;

        score *= trust / 100;
        score *= expBonus;
        score *= randomRange(rng, 0.8, 1.2);

        return this.pipeline.onCalcDomestic(
            context,
            this.actionKey,
            'score',
            score
        );
    }

    resolve(
        context: DomesticActionContext<TriggerState>,
        rng: RandomGenerator
    ): CommerceInvestmentResult {
        const { gold: costGold, rice: costRice } = this.getCost(context);
        const trust =
            getMetaNumber(context.city.meta, 'trust') ??
            this.env.defaultTrust ??
            DEFAULT_TRUST;
        let score = clamp(this.calcBaseScore(context, rng), 1, Number.MAX_SAFE_INTEGER);

        const ratio =
            this.env.getCriticalRatio?.(context, this.statKey) ?? {
                success: 0,
                fail: 0,
            };
        let successRatio = ratio.success;
        let failRatio = ratio.fail;
        if (trust < 80) {
            successRatio *= trust / 80;
        }
        successRatio = this.pipeline.onCalcDomestic(
            context,
            this.actionKey,
            'success',
            successRatio
        );
        failRatio = this.pipeline.onCalcDomestic(
            context,
            this.actionKey,
            'fail',
            failRatio
        );

        successRatio = clamp(successRatio, 0, 1);
        failRatio = clamp(failRatio, 0, 1 - successRatio);
        const normalRatio = 1 - successRatio - failRatio;

        const pick = pickByWeight(rng, {
            fail: failRatio,
            success: successRatio,
            normal: normalRatio,
        });

        const criticalMultiplier =
            this.env.getCriticalScoreMultiplier?.(rng, pick) ?? 1;
        score = Math.round(score * criticalMultiplier);

        const frontStates =
            this.env.frontStatesWithDebuff ?? DEFAULT_FRONT_STATES;
        let appliedFrontDebuff = false;
        if (frontStates.includes(context.city.frontState)) {
            const baseDebuff =
                this.env.frontDebuff ?? DEFAULT_FRONT_DEBUFF;
            const adjustedDebuff =
                this.env.adjustFrontDebuff?.(context, baseDebuff) ?? baseDebuff;
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
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements GeneralActionResolver<TriggerState> {
    readonly key = 'che_상업투자';
    private readonly command: CommandResolver<TriggerState>;

    constructor(
        modules: Array<GeneralActionModule<TriggerState> | null | undefined>,
        env: InvestmentEnvironment
    ) {
        this.command = new CommandResolver(modules, env);
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>
    ): GeneralActionOutcome<TriggerState> {
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

        const updatedCommerce = clamp(
            city.commerce + result.score,
            0,
            city.commerceMax
        );

        const nextGold = Math.max(0, general.gold - result.costGold);
        const nextRice = Math.max(0, general.rice - result.costRice);
        const nextExperience = general.experience + result.exp;
        const nextDedication = general.dedication + result.dedication;

        const metaWithStatExp = addMetaNumber(general.meta, STAT_EXP_KEY, 1);
        const metaUpdated =
            result.pick === 'success'
                ? { ...metaWithStatExp, max_domestic_critical: result.score }
                : { ...metaWithStatExp, max_domestic_critical: 0 };

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createCityPatchEffect({
                [CITY_KEY]: updatedCommerce,
            } as Partial<City>),
            createGeneralPatchEffect({
                gold: nextGold,
                rice: nextRice,
                experience: nextExperience,
                dedication: nextDedication,
                meta: metaUpdated,
            }),
        ];

        const pickLabel =
            result.pick === 'success'
                ? '성공'
                : result.pick === 'fail'
                    ? '실패'
                    : '완료';
        const logMessage = `${ACTION_NAME} ${pickLabel}: +${Math.round(result.score)}`;
        effects.push(createLogEffect(logMessage));

        return { effects };
    }
}
