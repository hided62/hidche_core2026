import { JosaUtil, type RandomGenerator } from '@sammo-ts/common';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import type {
    ActionContextBase,
    ActionContextBuilder,
    ActionContextOptions,
} from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
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
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import type { City, General, GeneralMeta, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import { searchDistance } from '@sammo-ts/logic/world/distance.js';
import { clamp } from 'es-toolkit';
import { z } from 'zod';

import { formatDestCityConstraintFailure } from '../constraintFailure.js';
import { parseArgsWithSchema } from '../parseArgs.js';
import { consumeSuccessfulStrategyItem } from './strategyItemConsumption.js';

export const STRATEGY_ARGS_SCHEMA = z.object({
    destCityId: z.number(),
});

export type StrategyArgs = z.infer<typeof STRATEGY_ARGS_SCHEMA>;
export type StrategyStatKey = 'leadership' | 'strength' | 'intelligence';
export type StrategyStatExpKey = 'leadership_exp' | 'strength_exp' | 'intel_exp';
export type StrategyDamageMode = 'fire' | 'agitate' | 'destroy' | 'seize';

export interface StrategyActionConfig {
    key: 'che_화계' | 'che_선동' | 'che_파괴' | 'che_탈취';
    name: '화계' | '선동' | '파괴' | '탈취';
    statKey: StrategyStatKey;
    statExpKey: StrategyStatExpKey;
    damageMode: StrategyDamageMode;
    injuryGeneral: boolean;
}

export interface StrategyEnvironment {
    develCost: number;
    sabotageDefaultProb: number;
    sabotageProbCoefByStat: number;
    sabotageDefenceCoefByGeneralCount: number;
    sabotageDamageMin: number;
    sabotageDamageMax: number;
    maxSuccessProbability?: number;
    getDistance?: (sourceCityId: number, destCityId: number) => number | null;
    getDefenceCorrection?: (context: StrategyContext, defender: General) => number;
    getInjuryProbability?: (context: StrategyContext, defender: General) => number;
}

export interface StrategyContext<
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

export interface StrategyResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity: City;
    destNation?: Nation | null;
    destGenerals: General<TriggerState>[];
    distance?: number;
    year?: number;
    startYear?: number;
}

export interface StrategyProbability {
    attack: number;
    defence: number;
    distance: number;
    success: number;
}

export interface StrategyResult<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    success: boolean;
    probability: StrategyProbability;
    costGold: number;
    costRice: number;
    exp: number;
    dedication: number;
    primaryAmount: number;
    secondaryAmount: number;
    injuryCount: number;
    injuredGenerals: Array<{
        id: number;
        patch: Partial<General<TriggerState>>;
    }>;
}

const DEFAULT_MAX_PROBABILITY = 0.5;
const INJURY_MAX = 80;

const randomRangeInt = (rng: RandomGenerator, min: number, max: number): number => rng.nextInt(min, max + 1);

const getStatValue = (general: General, statKey: StrategyStatKey): number => general.stats[statKey];

const addMetaNumber = (meta: GeneralMeta, key: string, delta: number): GeneralMeta => {
    const current = typeof meta[key] === 'number' ? (meta[key] as number) : 0;
    return { ...meta, [key]: current + delta };
};

/** Ref `che_화계`가 소유한 네 계략의 공통 확률, RNG, 비용과 성장 계산을 분리한 기반. */
export class StrategyCommandResolver<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        private readonly env: StrategyEnvironment,
        private readonly config: StrategyActionConfig
    ) {
        this.pipeline = new GeneralActionPipeline(modules);
    }

    getCost(): { gold: number; rice: number } {
        const cost = this.env.develCost * 5;
        return { gold: cost, rice: cost };
    }

    getProbability(context: StrategyContext<TriggerState>): StrategyProbability {
        const attackBase = getStatValue(context.general, this.config.statKey) / this.env.sabotageProbCoefByStat;
        const attack = this.pipeline.onCalcDomestic(context, '계략', 'success', attackBase);

        const destNationId = context.destCity.nationId;
        let maxStat = 0;
        let defenceCorrection = 0;
        let affectCount = 0;
        for (const defender of context.destGenerals ?? []) {
            if (defender.nationId !== destNationId) {
                continue;
            }
            affectCount += 1;
            maxStat = Math.max(maxStat, getStatValue(defender, this.config.statKey));
            defenceCorrection += this.env.getDefenceCorrection?.(context, defender) ?? 0;
        }

        let defence = maxStat / this.env.sabotageProbCoefByStat;
        defence += defenceCorrection;
        defence += (Math.log2(affectCount + 1) - 1.25) * this.env.sabotageDefenceCoefByGeneralCount;
        defence += context.destCity.security / context.destCity.securityMax / 5;
        defence += context.destCity.supplyState ? 0.1 : 0;

        const distance = context.distance ?? this.env.getDistance?.(context.general.cityId, context.destCity.id) ?? 99;
        const success = clamp(
            (this.env.sabotageDefaultProb + attack - defence) / distance,
            0,
            this.env.maxSuccessProbability ?? DEFAULT_MAX_PROBABILITY
        );
        return { attack, defence, distance, success };
    }

    resolve(context: StrategyContext<TriggerState>, rng: RandomGenerator): StrategyResult<TriggerState> {
        const { gold: costGold, rice: costRice } = this.getCost();
        const probability = this.getProbability(context);
        const success = rng.nextBool(probability.success);

        if (!success) {
            return {
                success,
                probability,
                costGold,
                costRice,
                exp: randomRangeInt(rng, 1, 100),
                dedication: randomRangeInt(rng, 1, 70),
                primaryAmount: 0,
                secondaryAmount: 0,
                injuryCount: 0,
                injuredGenerals: [],
            };
        }

        const injuredGenerals: Array<{
            id: number;
            patch: Partial<General<TriggerState>>;
        }> = [];
        for (const defender of this.config.injuryGeneral ? (context.destGenerals ?? []) : []) {
            if (defender.nationId !== context.destCity.nationId) {
                continue;
            }
            const injuryProbability = this.env.getInjuryProbability?.(context, defender) ?? 0.3;
            if (!rng.nextBool(injuryProbability)) {
                continue;
            }
            injuredGenerals.push({
                id: defender.id,
                patch: {
                    injury: clamp(defender.injury + randomRangeInt(rng, 1, 16), 0, INJURY_MAX),
                    crew: Math.round(defender.crew * 0.98),
                    atmos: Math.round(defender.atmos * 0.98),
                    train: Math.round(defender.train * 0.98),
                },
            });
        }

        let primaryAmount: number;
        let secondaryAmount: number;
        if (this.config.damageMode === 'agitate') {
            primaryAmount = clamp(
                randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax),
                0,
                context.destCity.security
            );
            const trust = typeof context.destCity.meta.trust === 'number' ? context.destCity.meta.trust : 0;
            secondaryAmount = clamp(
                (this.env.sabotageDamageMin +
                    rng.nextFloat1() * (this.env.sabotageDamageMax - this.env.sabotageDamageMin)) /
                    50,
                0,
                trust
            );
        } else if (this.config.damageMode === 'destroy') {
            primaryAmount = clamp(
                randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax),
                0,
                context.destCity.defence
            );
            secondaryAmount = clamp(
                randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax),
                0,
                context.destCity.wall
            );
        } else if (this.config.damageMode === 'seize') {
            primaryAmount = randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax);
            secondaryAmount = randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax);
        } else {
            primaryAmount = clamp(
                randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax),
                0,
                context.destCity.agriculture
            );
            secondaryAmount = clamp(
                randomRangeInt(rng, this.env.sabotageDamageMin, this.env.sabotageDamageMax),
                0,
                context.destCity.commerce
            );
        }

        return {
            success,
            probability,
            costGold,
            costRice,
            exp: randomRangeInt(rng, 201, 300),
            dedication: randomRangeInt(rng, 141, 210),
            primaryAmount,
            secondaryAmount,
            injuryCount: injuredGenerals.length,
            injuredGenerals,
        };
    }
}

export abstract class StrategyActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, StrategyArgs> {
    public readonly key: StrategyActionConfig['key'];
    protected readonly pipeline: GeneralActionPipeline<TriggerState>;
    private readonly command: StrategyCommandResolver<TriggerState>;

    protected constructor(
        protected readonly env: TurnCommandEnv,
        protected readonly config: StrategyActionConfig
    ) {
        const modules = env.generalActionModules ?? [];
        this.key = config.key;
        this.pipeline = new GeneralActionPipeline(modules);
        this.command = new StrategyCommandResolver<TriggerState>(modules, env, config);
    }

    protected abstract resolveSuccess(
        context: StrategyResolveContext<TriggerState>,
        args: StrategyArgs,
        result: StrategyResult<TriggerState>,
        effects: GeneralActionEffect<TriggerState>[]
    ): void;

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: StrategyArgs
    ): GeneralActionOutcome<TriggerState> {
        const strategyContext = context as StrategyResolveContext<TriggerState>;
        const { general, city, destCity } = strategyContext;
        if (!city) {
            throw new Error('Strategy command requires a source city context.');
        }
        if (!destCity) {
            throw new Error('Strategy command requires a target city context.');
        }

        const result = this.command.resolve(
            {
                ...strategyContext,
                city,
                destCity,
                destGenerals: strategyContext.destGenerals,
            },
            strategyContext.rng
        );

        general.gold = Math.max(0, general.gold - result.costGold);
        general.rice = Math.max(0, general.rice - result.costRice);
        general.experience += result.exp;
        general.dedication += result.dedication;
        general.meta = addMetaNumber(general.meta, this.config.statExpKey, 1);

        if (!result.success) {
            strategyContext.addLog(
                `<G><b>${destCity.name}</b></>에 ${this.config.name}${JosaUtil.pick(this.config.name, '이')} 실패했습니다.`,
                { format: LogFormat.MONTH }
            );
            return { effects: [] };
        }

        general.meta = addMetaNumber(general.meta, 'firenum', 1);
        const effects: GeneralActionEffect<TriggerState>[] = [];

        // Ref의 SabotageInjury()는 대상 도시 효과/성공 로그보다 먼저 저장된다.
        for (const injured of result.injuredGenerals) {
            effects.push(createGeneralPatchEffect(injured.patch, injured.id));
            strategyContext.addLog('<M>계략</>으로 인해 <R>부상</>을 당했습니다.', {
                generalId: injured.id,
                format: LogFormat.MONTH,
            });
        }

        this.resolveSuccess(strategyContext, args, result, effects);

        const itemCode = general.role.items.item;
        const consumedItems = consumeSuccessfulStrategyItem(this.pipeline, strategyContext);
        if (typeof itemCode === 'string' && consumedItems.includes(itemCode)) {
            const item = this.env.itemCatalog?.[itemCode];
            const itemName = item?.name ?? itemCode;
            const itemRawName = item?.rawName ?? itemName;
            strategyContext.addLog(`<C>${itemName}</>${JosaUtil.pick(itemRawName, '을')} 사용!`, {
                format: LogFormat.PLAIN,
            });
        }

        return { effects };
    }
}

export class StrategyActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, StrategyArgs, StrategyResolveContext<TriggerState>> {
    public readonly key: StrategyActionConfig['key'];
    public readonly name: StrategyActionConfig['name'];
    private readonly command: StrategyCommandResolver<TriggerState>;

    protected constructor(
        env: TurnCommandEnv,
        config: StrategyActionConfig,
        private readonly resolver: StrategyActionResolver<TriggerState>
    ) {
        this.key = config.key;
        this.name = config.name;
        this.command = new StrategyCommandResolver<TriggerState>(env.generalActionModules ?? [], env, config);
    }

    parseArgs(raw: unknown): StrategyArgs | null {
        return parseArgsWithSchema(STRATEGY_ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: StrategyArgs): Constraint[] {
        const { gold, rice } = this.command.getCost();
        return [notBeNeutral(), occupiedCity(), suppliedCity(), reqGeneralGold(() => gold), reqGeneralRice(() => rice)];
    }

    buildConstraints(_ctx: ConstraintContext, _args: StrategyArgs): Constraint[] {
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

    formatConstraintFailure(
        reason: string,
        _ctx: ConstraintContext,
        args: StrategyArgs,
        view: StateView
    ): string | null {
        return formatDestCityConstraintFailure(reason, this.name, args.destCityId, view, 'location');
    }

    resolve(context: StrategyResolveContext<TriggerState>, args: StrategyArgs): GeneralActionOutcome<TriggerState> {
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
        year: options.world.currentYear,
        startYear: options.scenarioMeta?.startYear ?? options.world.currentYear,
    };
};

export const strategyActionContextBuilder: ActionContextBuilder = buildStrategyActionContext;
