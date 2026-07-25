import type { RandomGenerator } from '@sammo-ts/common';
import type {
    City,
    General,
    GeneralMeta,
    GeneralTriggerState,
    Nation,
    TriggerValue,
} from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    disallowDiplomacyBetweenStatus,
    notBeNeutral,
    notNeutralDestCity,
    notOccupiedDestCity,
    occupiedCity,
    reqGeneralGold,
    reqGeneralRice,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createCityPatchEffect, createGeneralPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type {
    ActionContextBase,
    ActionContextBuilder,
    ActionContextOptions,
} from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { clamp } from 'es-toolkit';
import { parseArgsWithSchema } from '../parseArgs.js';
import { consumeSuccessfulStrategyItem } from './strategyItemConsumption.js';
import { searchDistance } from '@sammo-ts/logic/world/distance.js';

export interface FireAttackEnvironment {
    develCost: number;
    sabotageDefaultProb: number;
    sabotageProbCoefByStat: number;
    sabotageDefenceCoefByGeneralCount: number;
    sabotageDamageMin: number;
    sabotageDamageMax: number;
    maxSuccessProbability?: number;
    statKey?: 'leadership' | 'strength' | 'intelligence';
    getDistance?: (sourceCityId: number, destCityId: number) => number | null;
    getDefenceCorrection?: (context: FireAttackContext, defender: General) => number;
    getInjuryProbability?: (context: FireAttackContext, defender: General) => number;
    damageMode?: 'fire' | 'agitate' | 'destroy' | 'seize';
    injuryGeneral?: boolean;
}

export interface FireAttackContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionContext<TriggerState> {
    general: General<TriggerState>;
    city: City;
    nation?: Nation | null;
    destCity: City;
    destNation?: Nation | null;
    destGenerals: General<TriggerState>[];
    distance?: number;
}

export interface FireAttackResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity: City;
    destNation?: Nation | null;
    destGenerals: General<TriggerState>[];
    distance?: number;
}

export interface FireAttackResult<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    success: boolean;
    probability: number;
    distance: number;
    costGold: number;
    costRice: number;
    exp: number;
    dedication: number;
    agriDamage: number;
    commDamage: number;
    injuryCount: number;
    injuredGenerals: Array<{
        id: number;
        patch: Partial<General<TriggerState>>;
    }>;
}

const ACTION_NAME = '화계';
const ACTION_KEY = '계략';
const ARGS_SCHEMA = z.object({
    destCityId: z.number(),
});
export type FireAttackArgs = z.infer<typeof ARGS_SCHEMA>;
const STAT_EXP_KEY = 'intel_exp';
const DEFAULT_MAX_PROB = 0.5;
const INJURY_MAX = 80;
const CITY_STATE_BURNING = 32;

const randomRangeInt = (rng: RandomGenerator, min: number, max: number): number => rng.nextInt(min, max + 1);

const getStatValue = (general: General, statKey: 'leadership' | 'strength' | 'intelligence'): number => {
    if (statKey === 'leadership') {
        return general.stats.leadership;
    }
    if (statKey === 'strength') {
        return general.stats.strength;
    }
    return general.stats.intelligence;
};

const addMetaNumber = (meta: GeneralMeta, key: string, delta: number): GeneralMeta => {
    const current = typeof meta[key] === 'number' ? (meta[key] as number) : 0;
    return { ...meta, [key]: current + delta };
};

// 화계 성공/실패 및 피해량 계산을 담당한다.
export class CommandResolver<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private readonly pipeline: GeneralActionPipeline<TriggerState>;
    private readonly env: FireAttackEnvironment;
    private readonly statKey: 'leadership' | 'strength' | 'intelligence';

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: FireAttackEnvironment) {
        this.pipeline = new GeneralActionPipeline(modules);
        this.env = env;
        this.statKey = env.statKey ?? 'intelligence';
    }

    getCost(): { gold: number; rice: number } {
        const cost = this.env.develCost * 5;
        return { gold: cost, rice: cost };
    }

    private calcAttackProb(context: FireAttackContext<TriggerState>): number {
        const stat = getStatValue(context.general, this.statKey);
        const prob = stat / this.env.sabotageProbCoefByStat;
        return this.pipeline.onCalcDomestic(context, ACTION_KEY, 'success', prob);
    }

    private calcDefenceProb(context: FireAttackContext<TriggerState>): number {
        const destNationId = context.destCity.nationId;
        let maxStat = 0;
        let probCorrection = 0;
        let affectCount = 0;

        for (const defender of context.destGenerals ?? []) {
            if (defender.nationId !== destNationId) {
                continue;
            }
            affectCount += 1;
            maxStat = Math.max(maxStat, getStatValue(defender, this.statKey));
            probCorrection += this.env.getDefenceCorrection?.(context, defender) ?? 0;
        }

        let prob = maxStat / this.env.sabotageProbCoefByStat;
        prob += probCorrection;
        prob += (Math.log2(affectCount + 1) - 1.25) * this.env.sabotageDefenceCoefByGeneralCount;

        prob += context.destCity.security / context.destCity.securityMax / 5;
        prob += context.destCity.supplyState ? 0.1 : 0;

        return prob;
    }

    resolve(context: FireAttackContext<TriggerState>, rng: RandomGenerator): FireAttackResult<TriggerState> {
        const { gold: costGold, rice: costRice } = this.getCost();
        const distance = context.distance ?? this.env.getDistance?.(context.general.cityId, context.destCity.id) ?? 99;

        const attackProb = this.calcAttackProb(context);
        const defenceProb = this.calcDefenceProb(context);
        let probability = this.env.sabotageDefaultProb + attackProb - defenceProb;
        probability /= distance;
        probability = clamp(probability, 0, this.env.maxSuccessProbability ?? DEFAULT_MAX_PROB);

        const success = rng.nextBool(probability);

        if (!success) {
            return {
                success,
                probability,
                distance,
                costGold,
                costRice,
                exp: randomRangeInt(rng, 1, 100),
                dedication: randomRangeInt(rng, 1, 70),
                agriDamage: 0,
                commDamage: 0,
                injuryCount: 0,
                injuredGenerals: [],
            };
        }

        const injuryProbDefault = 0.3;
        const injuredGenerals: Array<{
            id: number;
            patch: Partial<General<TriggerState>>;
        }> = [];
        for (const defender of this.env.injuryGeneral === false ? [] : (context.destGenerals ?? [])) {
            if (defender.nationId !== context.destCity.nationId) {
                continue;
            }
            const injuryProb = this.env.getInjuryProbability?.(context, defender) ?? injuryProbDefault;
            if (!rng.nextBool(injuryProb)) {
                continue;
            }
            const injuryAmount = randomRangeInt(rng, 1, 16);
            injuredGenerals.push({
                id: defender.id,
                patch: {
                    injury: clamp(defender.injury + injuryAmount, 0, INJURY_MAX),
                    crew: Math.floor(defender.crew * 0.98),
                    atmos: Math.floor(defender.atmos * 0.98),
                    train: Math.floor(defender.train * 0.98),
                },
            });
        }

        const damageMode = this.env.damageMode ?? 'fire';
        let agriDamage: number;
        let commDamage: number;
        if (damageMode === 'agitate') {
            agriDamage = clamp(
                randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax),
                0,
                context.destCity.security
            );
            const trust = typeof context.destCity.meta.trust === 'number' ? context.destCity.meta.trust : 0;
            commDamage = clamp(
                (this.env.sabotageDamageMin +
                    rng.nextFloat1() * (this.env.sabotageDamageMax - this.env.sabotageDamageMin)) /
                    50,
                0,
                trust
            );
        } else if (damageMode === 'destroy') {
            agriDamage = clamp(
                randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax),
                0,
                context.destCity.defence
            );
            commDamage = clamp(
                randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax),
                0,
                context.destCity.wall
            );
        } else if (damageMode === 'seize') {
            agriDamage = randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax);
            commDamage = randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax);
        } else {
            agriDamage = clamp(
                randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax),
                0,
                context.destCity.agriculture
            );
            commDamage = clamp(
                randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax),
                0,
                context.destCity.commerce
            );
        }

        return {
            success,
            probability,
            distance,
            costGold,
            costRice,
            exp: randomRangeInt(rng, 201, 300),
            dedication: randomRangeInt(rng, 141, 210),
            agriDamage,
            commDamage,
            injuryCount: injuredGenerals.length,
            injuredGenerals,
        };
    }
}

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, FireAttackArgs> {
    readonly key = 'che_화계';
    private readonly command: CommandResolver<TriggerState>;
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: FireAttackEnvironment) {
        this.command = new CommandResolver(modules, env);
        this.pipeline = new GeneralActionPipeline(modules);
    }

    resolve(
        context: FireAttackResolveContext<TriggerState>,
        _args: FireAttackArgs
    ): GeneralActionOutcome<TriggerState> {
        void _args;
        const general = context.general;
        const city = context.city;
        if (!city) {
            throw new Error('Fire attack requires a city context.');
        }

        const result = this.command.resolve(
            {
                ...context,
                city,
                nation: context.nation ?? null,
                destCity: context.destCity,
                destNation: context.destNation ?? null,
                destGenerals: context.destGenerals,
            },
            context.rng
        );

        const effects: Array<GeneralActionEffect<TriggerState>> = [];

        const nextGold = Math.max(0, general.gold - result.costGold);
        const nextRice = Math.max(0, general.rice - result.costRice);
        const nextExperience = general.experience + result.exp;
        const nextDedication = general.dedication + result.dedication;

        const metaWithStatExp = addMetaNumber(general.meta, STAT_EXP_KEY, 1);
        const metaUpdated = result.success ? addMetaNumber(metaWithStatExp, 'firenum', 1) : metaWithStatExp;

        // 직접 수정 (Immer Draft)
        general.gold = nextGold;
        general.rice = nextRice;
        general.experience = nextExperience;
        general.dedication = nextDedication;
        general.meta = metaUpdated;

        const commandName = ACTION_NAME;

        if (!result.success) {
            context.addLog(
                `<G><b>${context.destCity.name}</b></>에 ${commandName}${JosaUtil.pick(commandName, '이')} 실패했습니다.`,
                {
                    format: LogFormat.MONTH,
                }
            );
            return { effects: [] };
        }

        const updatedCityMeta: Record<string, TriggerValue> = {
            ...context.destCity.meta,
            state: CITY_STATE_BURNING,
        };

        // 타겟 도시는 Draft가 아니므로 Effect 반환
        effects.push(
            createCityPatchEffect(
                {
                    agriculture: context.destCity.agriculture - result.agriDamage,
                    commerce: context.destCity.commerce - result.commDamage,
                    meta: updatedCityMeta,
                },
                context.destCity.id
            )
        );

        const destCityName = context.destCity.name;
        context.addLog(`<G><b>${destCityName}</b></>${JosaUtil.pick(destCityName, '이')} 불타고 있습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.SUMMARY,
            format: LogFormat.MONTH,
        });
        context.addLog(
            `<G><b>${context.destCity.name}</b></>에 ${commandName}${JosaUtil.pick(commandName, '이')} 성공했습니다.`,
            {
                format: LogFormat.MONTH,
            }
        );
        context.addLog(
            `도시의 농업이 <C>${result.agriDamage}</>, 상업이 <C>${result.commDamage}</>만큼 감소하고, 장수 <C>${result.injuryCount}</>명이 부상 당했습니다.`,
            {
                format: LogFormat.PLAIN,
            }
        );

        const itemCode = general.role.items.item;
        const actionResult = consumeSuccessfulStrategyItem(this.pipeline, context);
        const consumedItems = Array.isArray(actionResult?.['consumedItems']) ? actionResult['consumedItems'] : [];
        if (typeof itemCode === 'string' && consumedItems.includes(itemCode)) {
            context.addLog(`<C>${itemCode}</>${JosaUtil.pick(itemCode, '을')} 사용!`, {
                format: LogFormat.PLAIN,
            });
        }

        for (const injured of result.injuredGenerals) {
            // 타겟 장수는 Draft가 아니므로 Effect 반환
            effects.push(createGeneralPatchEffect(injured.patch, injured.id));
            context.addLog(`<M>${ACTION_KEY}</>로 인해 <R>부상</>을 당했습니다.`, {
                generalId: injured.id,
                format: LogFormat.MONTH,
            });
        }

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, FireAttackArgs, FireAttackResolveContext<TriggerState>> {
    public readonly key = 'che_화계';
    public readonly name = ACTION_NAME;
    private readonly command: CommandResolver<TriggerState>;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>, env: FireAttackEnvironment) {
        this.command = new CommandResolver(modules, env);
        this.resolver = new ActionResolver(modules, env);
    }

    parseArgs(raw: unknown): FireAttackArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: FireAttackArgs): Constraint[] {
        const { gold, rice } = this.command.getCost();
        return [notBeNeutral(), occupiedCity(), suppliedCity(), reqGeneralGold(() => gold), reqGeneralRice(() => rice)];
    }

    buildConstraints(_ctx: ConstraintContext, _args: FireAttackArgs): Constraint[] {
        void _ctx;
        void _args;
        const { gold, rice } = this.command.getCost();
        return [
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            notOccupiedDestCity(),
            notNeutralDestCity(),
            reqGeneralGold(() => gold),
            reqGeneralRice(() => rice),
            disallowDiplomacyBetweenStatus({
                7: '불가침국입니다.',
            }),
        ];
    }

    resolve(context: FireAttackResolveContext<TriggerState>, args: FireAttackArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const buildStrategyActionContext = (base: ActionContextBase, options: ActionContextOptions) => {
    const destCityId = options.actionArgs.destCityId;
    if (typeof destCityId !== 'number' || !options.worldRef) {
        return null;
    }
    const destCity = options.worldRef.getCityById(destCityId);
    if (!destCity) {
        return null;
    }
    const destNation = destCity.nationId > 0 ? options.worldRef.getNationById(destCity.nationId) : null;
    const destGenerals = options.worldRef
        .listGenerals()
        .filter((general) => general.cityId === destCity.id && general.nationId === destCity.nationId);
    const distance = options.map ? (searchDistance(options.map, base.general.cityId, 5)[destCity.id] ?? 99) : 99;
    return {
        ...base,
        destCity,
        destNation,
        destGenerals,
        distance,
    };
};

export const actionContextBuilder: ActionContextBuilder = buildStrategyActionContext;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_화계',
    category: '계략',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? [], env),
};
