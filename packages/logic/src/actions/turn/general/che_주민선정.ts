import type { RandomGenerator } from '@sammo-ts/common';
import { JosaUtil } from '@sammo-ts/common';
import type { City, General, GeneralMeta, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, RequirementKey } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    occupiedCity,
    reqGeneralGold,
    reqGeneralRice,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { clamp } from 'es-toolkit';

export interface DomesticActionContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionContext<TriggerState> {
    general: General<TriggerState>;
    city: City;
    nation?: Nation | null;
}

export interface TrustEnvironment {
    develCost: number;
    defaultTrust?: number;
}

export interface TrustActionArgs {}

const ACTION_NAME = '주민 선정';
const ACTION_KEY = '민심';
const STAT_EXP_KEY = 'leadership_exp';
const DEFAULT_TRUST = 50;

const getMetaNumber = (meta: Record<string, unknown>, key: string): number | null => {
    const raw = meta[key];
    return typeof raw === 'number' ? raw : null;
};

const addMetaNumber = (meta: GeneralMeta, key: string, delta: number): GeneralMeta => {
    const current = getMetaNumber(meta, key) ?? 0;
    return { ...meta, [key]: current + delta };
};

const randomRange = (rng: RandomGenerator, min: number, max: number): number => min + (max - min) * rng.nextFloat1();

const remainCityTrust = (): Constraint => ({
    name: 'remainCityTrust',
    requires: (ctx) => (ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : []),
    test: (ctx, view) => {
        const city = ctx.cityId !== undefined ? (view.get({ kind: 'city', id: ctx.cityId }) as City | null) : null;
        if (!city) {
            return { kind: 'deny', reason: '도시 정보가 없습니다.' };
        }
        const trust = getMetaNumber(city.meta, 'trust') ?? DEFAULT_TRUST;
        if (trust >= 100) {
            return { kind: 'deny', reason: '민심이 충분합니다.' };
        }
        return { kind: 'allow' };
    },
});

export class CommandResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> {
    private readonly pipeline: GeneralActionPipeline<TriggerState>;
    private readonly env: TrustEnvironment;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: TrustEnvironment) {
        this.pipeline = new GeneralActionPipeline(modules);
        this.env = env;
    }

    calcBaseScore(context: DomesticActionContext<TriggerState>, rng: RandomGenerator): number {
        let score = this.pipeline.onCalcStat(context, 'leadership', context.general.stats.leadership);
        score *= randomRange(rng, 0.8, 1.2);
        return this.pipeline.onCalcDomestic(context, ACTION_KEY, 'score', score);
    }

    resolve(context: DomesticActionContext<TriggerState>, rng: RandomGenerator): {
        trustDelta: number;
        exp: number;
        dedication: number;
        costRice: number;
    } {
        const costRice = (this.env.develCost ?? 0) * 2;
        const baseScore = clamp(this.calcBaseScore(context, rng), 1, Number.MAX_SAFE_INTEGER);
        const exp = baseScore * 0.7;
        const dedication = baseScore * 1.0;
        const trustDelta = Math.round(baseScore) / 10;
        return { trustDelta, exp, dedication, costRice };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, TrustActionArgs> {
    public readonly key = 'che_주민선정';
    public readonly name = ACTION_NAME;
    private readonly command: CommandResolver<TriggerState>;
    private readonly env: TrustEnvironment;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: TrustEnvironment) {
        this.env = env;
        this.command = new CommandResolver(modules, env);
    }

    parseArgs(_raw: unknown): TrustActionArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(ctx: ConstraintContext, _args: TrustActionArgs): Constraint[] {
        void _args;
        const requirements: RequirementKey[] = [];
        if (ctx.cityId !== undefined) {
            requirements.push({ kind: 'city', id: ctx.cityId });
        }
        if (ctx.nationId !== undefined) {
            requirements.push({ kind: 'nation', id: ctx.nationId });
        }

        const getRiceCost = (): number => (this.env.develCost ?? 0) * 2;

        return [
            notBeNeutral(),
            notWanderingNation(),
            occupiedCity(),
            suppliedCity(),
            reqGeneralGold(() => 0, requirements),
            reqGeneralRice(getRiceCost, requirements),
            remainCityTrust(),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: TrustActionArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const city = context.city;
        if (!city) {
            context.addLog('도시 정보를 찾지 못했습니다.');
            return { effects: [] };
        }
        const trust = getMetaNumber(city.meta, 'trust') ?? this.env.defaultTrust ?? DEFAULT_TRUST;
        const result = this.command.resolve(
            {
                ...context,
                city,
                nation: context.nation ?? null,
            },
            context.rng
        );

        const nextTrust = clamp(trust + result.trustDelta, 0, 100);
        city.meta = { ...city.meta, trust: nextTrust };
        general.rice = Math.max(0, general.rice - result.costRice);
        general.experience += result.exp;
        general.dedication += result.dedication;
        general.meta = { ...addMetaNumber(general.meta, STAT_EXP_KEY, 1), max_domestic_critical: 0 };

        const scoreText = result.trustDelta.toFixed(1);
        const logName = ACTION_NAME.replace(' ', '');
        const josaUl = JosaUtil.pick(logName, '을');
        context.addLog(`${logName}${josaUl} 하여 <C>${scoreText}</> 상승했습니다.`);
        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });
        return { effects: [] };
    }
}

export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_주민선정',
    category: '내정',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? [], env),
};
