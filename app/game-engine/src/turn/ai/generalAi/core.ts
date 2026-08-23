import type {
    City,
    GeneralActionDefinition,
    MapDefinition,
    Nation,
    ScenarioConfig,
    ScenarioMeta,
    TurnCommandEnv,
    UnitSetDefinition,
} from '@sammo-ts/logic';
import { evaluateConstraints, LEGACY_DEFAULT_MAX_LEVEL } from '@sammo-ts/logic';
import type { ConstraintContext } from '@sammo-ts/logic';
import { GAME_TICKS_PER_TURN, LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';
import { resolveStartYear, resolveTurnTermMinutes } from '@sammo-ts/logic/actions/turn/actionContextHelpers.js';
import {
    AVAILABLE_NATION_TRAIT_KEYS,
    isAvailableNationTraitKey,
} from '@sammo-ts/logic/actionModules/traits/nation/index.js';
import { GeneralActionPipeline } from '@sammo-ts/logic/actionModules/general.js';

import type { ReservedTurnEntry } from '../../reservedTurnStore.js';
import type { TurnGeneral, TurnWorldState } from '../../types.js';
import type { AiCommandCandidate, AiReservedTurnProvider, AiWorldView } from '../types.js';
import {
    AutorunGeneralPolicy,
    AutorunNationPolicy,
    canUseAutomatedNationAction,
    canUseRulerAutomation,
} from '../policies.js';
import {
    asRecord,
    joinYearMonth,
    readMetaNumber,
    readNumber,
    readRequiredMetaNumber,
    roundTo,
    valueFit,
    withCanonicalArgumentAliases,
} from '../aiUtils.js';
import { searchAllDistanceByNationList } from '@sammo-ts/logic/world/distance.js';
import { generalActionHandlers } from './general/index.js';
import { nationActionHandlers } from './nation/index.js';
import { resolveConstraintEnv, type ConstraintEnv } from './constraint.js';
import { buildSeedBase } from './seed.js';
import { WorldStateView } from './worldStateView.js';
import type { GeneralAIOptions, GeneralAiDebugState } from './types.js';

const ACTION_REST = '휴식';
const lastAttackableByWorld = new WeakMap<object, Map<number, number>>();

const t무장 = 1;
const t지장 = 2;
const t통솔장 = 4;

const d평화 = 0;
const d선포 = 1;
const d징병 = 2;
const d직전 = 3;
const d전쟁 = 4;

export const calculateRecentWarTurn = (general: TurnGeneral, turnTermMinutes: number): number => {
    if (general.recentWarTick !== null && general.recentWarTick !== undefined && general.turnTick !== undefined) {
        const tickDiff = general.turnTick - general.recentWarTick;
        return tickDiff <= 0 ? 0 : Math.floor(tickDiff / GAME_TICKS_PER_TURN);
    }
    const recent = general.recentWarTime;
    if (!recent) return 12000;
    const diffMs = general.turnTime.getTime() - recent.getTime();
    if (diffMs <= 0) return 0;
    const turnMs = turnTermMinutes * 60 * 1000;
    return turnMs > 0 ? Math.floor(diffMs / turnMs) : 12000;
};

export const selectNpcMessageForTurn = (
    message: unknown,
    rng: Pick<RandUtil, 'nextBool'>,
    frequencyPerDay: number,
    turnTermMinutes: number
): string | null => {
    if (!message) return null;
    return rng.nextBool((frequencyPerDay * turnTermMinutes) / (60 * 24)) ? String(message) : null;
};

export const resolveLegacyAiStats = (
    general: Pick<TurnGeneral, 'injury' | 'officerLevel' | 'stats'>,
    nation: Nation | null | undefined,
    maxStatLevel: number
) => {
    const maxLevel = Math.max(1, maxStatLevel);
    const clampStat = (value: number): number => Math.max(0, Math.min(value, maxLevel));
    const injuryRatio = (100 - Math.max(0, Math.min(general.injury, 100))) / 100;
    const nationLevel = nation?.level ?? 0;
    const leadershipBonus = general.officerLevel === 12 ? nationLevel * 2 : general.officerLevel >= 5 ? nationLevel : 0;
    const leadershipWithBonus = (value: number): number => clampStat(clampStat(value) + leadershipBonus);

    const injuredLeadership = general.stats.leadership * injuryRatio;
    const injuredStrength = general.stats.strength * injuryRatio;
    const injuredIntelligence = general.stats.intelligence * injuryRatio;

    return {
        fullLeadership: leadershipWithBonus(general.stats.leadership),
        fullStrength: clampStat(general.stats.strength + Math.round(general.stats.intelligence / 4)),
        fullIntelligence: clampStat(general.stats.intelligence + Math.round(general.stats.strength / 4)),
        effectiveLeadership: Math.trunc(leadershipWithBonus(injuredLeadership)),
        effectiveStrength: Math.trunc(clampStat(injuredStrength + Math.round(injuredIntelligence / 4))),
        effectiveIntelligence: Math.trunc(clampStat(injuredIntelligence + Math.round(injuredStrength / 4))),
    };
};

export const resolveLegacyAiStatsWithModules = (
    general: TurnGeneral,
    nation: Nation | null | undefined,
    maxStatLevel: number,
    modules: TurnCommandEnv['generalActionModules'],
    worldRef: AiWorldView | null,
    world: TurnWorldState,
    startYear: number,
    maxTechLevel = 12
) => {
    const maxLevel = Math.max(1, maxStatLevel);
    const clampStat = (value: number): number => Math.max(0, Math.min(value, maxLevel));
    const pipeline = new GeneralActionPipeline(modules ?? []);
    const context = {
        general,
        nation,
        ...(worldRef
            ? {
                  worldView: {
                      listGenerals: () => worldRef.listGenerals(),
                      listGeneralsByCity: (cityId: number) =>
                          worldRef.listGenerals().filter((candidate) => candidate.cityId === cityId),
                      listNations: () => worldRef.listNations(),
                  },
              }
            : {}),
        time: {
            year: world.currentYear,
            month: world.currentMonth,
            startYear,
        },
        maxTechLevel,
    };
    const rawStat = (statName: 'leadership' | 'strength' | 'intelligence'): number => general.stats[statName];
    const calculate = (
        statName: 'leadership' | 'strength' | 'intelligence',
        withInjury: boolean,
        withStatAdjust: boolean,
        truncate: boolean
    ): number => {
        const injuryRatio = withInjury ? (100 - Math.max(0, Math.min(general.injury, 100))) / 100 : 1;
        let value = rawStat(statName) * injuryRatio;
        if (withStatAdjust && statName === 'strength') {
            value += Math.round(calculate('intelligence', withInjury, false, false) / 4);
        } else if (withStatAdjust && statName === 'intelligence') {
            value += Math.round(calculate('strength', withInjury, false, false) / 4);
        }
        value = clampStat(value);
        value = clampStat(Number(pipeline.onCalcStat(context, statName, value)));
        return truncate ? Math.trunc(value) : value;
    };

    return {
        fullLeadership: calculate('leadership', false, true, true),
        fullStrength: calculate('strength', false, true, true),
        fullIntelligence: calculate('intelligence', false, true, true),
        effectiveLeadership: calculate('leadership', true, true, true),
        effectiveStrength: calculate('strength', true, true, true),
        effectiveIntelligence: calculate('intelligence', true, true, true),
    };
};

export class GeneralAI {
    public general: TurnGeneral;
    public city?: City;
    public nation?: Nation | null;
    public readonly world: TurnWorldState;
    public readonly worldRef: AiWorldView | null;
    public readonly map?: MapDefinition;
    public readonly unitSet?: UnitSetDefinition;
    public readonly commandEnv: TurnCommandEnv;
    public readonly scenarioConfig: ScenarioConfig;
    public readonly scenarioMeta?: ScenarioMeta;

    public readonly generalDefinitions: Map<string, GeneralActionDefinition>;
    public readonly nationDefinitions: Map<string, GeneralActionDefinition>;
    public readonly generalFallback: GeneralActionDefinition;
    public readonly nationFallback: GeneralActionDefinition;

    public readonly rng: RandUtil;
    public readonly env: ConstraintEnv;
    public readonly startYear: number;
    public readonly turnTermMinutes: number;
    private pendingNpcMessage: string | null = null;

    public readonly aiConst: {
        baseGold: number;
        baseRice: number;
        minAvailableRecruitPop: number;
        maxResourceActionAmount: number;
        minNationalGold: number;
        minNationalRice: number;
        defaultStatMax: number;
        defaultStatNpcMax: number;
        chiefStatMin: number;
        npcMessageFreqByDay: number;
        availableNationTypes: string[];
    };

    public generalPolicy: AutorunGeneralPolicy;
    public nationPolicy: AutorunNationPolicy;

    public genType = 0;
    public dipState = d평화;
    public warTargetNation: Record<number, number> = {};
    public attackable = false;
    public maxResourceActionAmount = 0;

    public nationCities: Record<
        number,
        City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
    > = {};
    public frontCities: Record<
        number,
        City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
    > = {};
    public supplyCities: Record<
        number,
        City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
    > = {};
    public backupCities: Record<
        number,
        City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
    > = {};
    public warRoute: Record<number, Record<number, number>> | null = null;

    public nationGenerals: TurnGeneral[] = [];
    public npcCivilGenerals: Record<number, TurnGeneral> = {};
    public npcWarGenerals: Record<number, TurnGeneral> = {};
    public userGenerals: Record<number, TurnGeneral> = {};
    public userWarGenerals: Record<number, TurnGeneral> = {};
    public userCivilGenerals: Record<number, TurnGeneral> = {};
    public chiefGenerals: Record<number, TurnGeneral> = {};
    public lostGenerals: Record<number, TurnGeneral> = {};
    public troopLeaders: Record<number, TurnGeneral> = {};

    private reqUpdateInstance = true;
    private devRate: Record<string, number> | null = null;
    private categorizedCities = false;
    private categorizedGenerals = false;
    private promotionPatches: Array<{
        generalId: number;
        officerLevel: number;
        officerCity: number;
        permission?: string;
    }> = [];
    private promotionNationMeta: Record<string, unknown> | null = null;
    private readonly initialGeneralMeta: Record<string, unknown>;

    private readonly reservedTurnProvider: AiReservedTurnProvider;

    constructor(options: GeneralAIOptions) {
        this.general = { ...options.general, meta: { ...options.general.meta } };
        this.initialGeneralMeta = { ...options.general.meta };
        this.city = options.city;
        const nation =
            options.nation ??
            (options.general.nationId > 0 ? (options.worldRef?.getNationById(options.general.nationId) ?? null) : null);
        this.nation = nation ? { ...nation, meta: { ...nation.meta } } : nation;
        this.world = options.world;
        this.worldRef = options.worldRef;
        this.map = options.map;
        this.unitSet = options.unitSet;
        this.commandEnv = options.commandEnv;
        this.scenarioConfig = options.scenarioConfig;
        this.scenarioMeta = options.scenarioMeta;
        this.reservedTurnProvider = options.reservedTurnProvider;

        this.generalDefinitions = options.generalDefinitions;
        this.nationDefinitions = options.nationDefinitions;
        this.generalFallback = options.generalFallback;
        this.nationFallback = options.nationFallback;

        this.startYear = resolveStartYear(this.world, this.scenarioMeta);
        this.turnTermMinutes = resolveTurnTermMinutes(this.world);
        this.env = resolveConstraintEnv(this.world, this.scenarioMeta, this.commandEnv);

        const seed = simpleSerialize(
            buildSeedBase(this.world),
            'GeneralAI',
            this.world.currentYear,
            this.world.currentMonth,
            this.general.id
        );
        if ((process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(this.general.id))) {
            process.stdout.write(
                `AI_GENERAL_SEED_TRACE ${JSON.stringify({
                    generalId: this.general.id,
                    year: this.world.currentYear,
                    month: this.world.currentMonth,
                    seedHex: Buffer.from(seed).toString('hex'),
                })}\n`
            );
        }
        const baseRng = new RandUtil(LiteHashDRBG.build(seed));
        const traceRng = (process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(this.general.id));
        let traceSequence = 0;
        this.rng = traceRng
            ? new Proxy(baseRng, {
                  get: (target, property, receiver) => {
                      const value = Reflect.get(target, property, receiver);
                      if (typeof value !== 'function') return value;
                      return (...args: unknown[]) => {
                          const result = Reflect.apply(value, receiver, args);
                          if (
                              [
                                  'nextFloat1',
                                  'nextRangeInt',
                                  'nextInt',
                                  'nextBit',
                                  'nextBool',
                                  'choice',
                                  'choiceUsingWeight',
                                  'choiceUsingWeightPair',
                              ].includes(String(property))
                          ) {
                              process.stdout.write(
                                  `AI_RNG_TRACE ${JSON.stringify({
                                      generalId: this.general.id,
                                      sequence: traceSequence++,
                                      method: String(property),
                                      caller: new Error().stack?.split('\n')[2]?.trim() ?? null,
                                      result:
                                          result === null || ['string', 'number', 'boolean'].includes(typeof result)
                                              ? result
                                              : Array.isArray(result)
                                                ? `[array:${result.length}]`
                                                : '[object]',
                                  })}\n`
                              );
                          }
                          return result;
                      };
                  },
              })
            : baseRng;

        const constValues = asRecord(this.scenarioConfig.const);
        this.aiConst = {
            baseGold: this.commandEnv.baseGold,
            baseRice: this.commandEnv.baseRice,
            minAvailableRecruitPop: readNumber(constValues.minAvailableRecruitPop, 30000),
            maxResourceActionAmount: this.commandEnv.maxResourceActionAmount || 10000,
            minNationalGold: readNumber(constValues.minNationalGold, this.commandEnv.baseGold),
            minNationalRice: readNumber(constValues.minNationalRice, this.commandEnv.baseRice),
            defaultStatMax: this.scenarioConfig.stat.max,
            defaultStatNpcMax: this.scenarioConfig.stat.npcMax,
            chiefStatMin: this.scenarioConfig.stat.chiefMin,
            npcMessageFreqByDay: readNumber(constValues.npcMessageFreqByDay, 0),
            availableNationTypes: Array.isArray(constValues.availableNationType)
                ? constValues.availableNationType.filter(
                      (value): value is string => typeof value === 'string' && isAvailableNationTraitKey(value)
                  )
                : [...AVAILABLE_NATION_TRAIT_KEYS],
        };

        const generalPolicy = new AutorunGeneralPolicy(
            this.general,
            asRecord((this.world.meta as Record<string, unknown>)?.autorun_user)?.options as Record<string, boolean>,
            asRecord(this.nation?.meta)?.npc_general_policy as Record<string, unknown> | null,
            asRecord(this.world.meta)?.npc_general_policy as Record<string, unknown> | null
        );
        const nationPolicy = new AutorunNationPolicy({
            general: this.general,
            aiOptions: asRecord((this.world.meta as Record<string, unknown>)?.autorun_user)?.options as Record<
                string,
                boolean
            > | null,
            nationPolicy: asRecord(this.nation?.meta)?.npc_nation_policy as Record<string, unknown> | null,
            serverPolicy: asRecord(this.world.meta)?.npc_nation_policy as Record<string, unknown> | null,
            nation: this.nation ?? {
                id: 0,
                name: '재야',
                color: '#000000',
                capitalCityId: null,
                chiefGeneralId: null,
                gold: 0,
                rice: 0,
                power: 0,
                level: 0,
                typeCode: 'neutral',
                meta: {},
            },
            env: this.commandEnv,
            scenarioConfig: this.scenarioConfig,
            unitSet: this.unitSet,
        });

        this.generalPolicy = generalPolicy;
        this.nationPolicy = nationPolicy;
    }

    chooseNationTurn(reservedTurn: ReservedTurnEntry): AiCommandCandidate | null {
        this.updateInstance();
        if (!this.nation || !this.worldRef) {
            return null;
        }
        this.categorizeNationCities();
        this.categorizeNationGeneral();

        if ([3, 6, 9, 12].includes(this.world.currentMonth)) {
            if (this.general.officerLevel === 12 && canUseRulerAutomation(this.general, 'promotion')) {
                this.chooseNpcPromotion();
            } else if (this.general.npcState >= 2) {
                this.chooseNonLordPromotion();
            }
        }

        if (reservedTurn.action !== ACTION_REST) {
            const reservedCandidate = this.buildNationCandidate(reservedTurn.action, reservedTurn.args, 'reserved');
            if (reservedCandidate) {
                return reservedCandidate;
            }
        }

        for (const actionName of this.nationPolicy.priority) {
            if (!this.nationPolicy.can(actionName)) {
                continue;
            }
            if (!canUseAutomatedNationAction(this.general, actionName)) {
                continue;
            }
            const handler = nationActionHandlers[actionName];
            if (!handler) {
                continue;
            }
            const result = handler(this);
            if (result) {
                // Ref refreshes the cached AI state after these selected nation
                // commands, before choosing the general command with the same
                // RNG. The refresh includes another mixed-general type draw.
                if (['유저장긴급포상', 'NPC긴급포상', '선전포고', '천도'].includes(actionName)) {
                    this.reqUpdateInstance = true;
                }
                return result;
            }
        }

        return this.buildNationCandidate(ACTION_REST, {}, 'neutral');
    }

    consumePromotionPatches(): {
        generals: Array<{ generalId: number; officerLevel: number; officerCity: number; permission?: string }>;
        nationMeta: Record<string, unknown> | null;
    } {
        const result = {
            generals: this.promotionPatches,
            nationMeta: this.promotionNationMeta,
        };
        this.promotionPatches = [];
        this.promotionNationMeta = null;
        return result;
    }

    consumePersistentGeneralMetaPatch(): { set: Record<string, unknown>; unset: string[] } {
        const transientKeys = new Set([
            'fullLeadership',
            'fullStrength',
            'fullIntelligence',
            'effectiveLeadership',
            'effectiveStrength',
            'effectiveIntelligence',
        ]);
        const set: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(this.general.meta)) {
            if (transientKeys.has(key) || Object.is(this.initialGeneralMeta[key], value)) continue;
            set[key] = value;
        }
        const unset = Object.keys(this.initialGeneralMeta).filter(
            (key) => !transientKeys.has(key) && !Object.prototype.hasOwnProperty.call(this.general.meta, key)
        );
        return { set, unset };
    }

    consumeNpcMessage(): string | null {
        const message = this.pendingNpcMessage;
        this.pendingNpcMessage = null;
        return message;
    }

    chooseGeneralTurn(reservedTurn: ReservedTurnEntry): AiCommandCandidate | null {
        this.updateInstance();
        if (!this.worldRef) {
            return null;
        }

        const generalMeta = asRecord(this.general.meta);
        this.pendingNpcMessage = selectNpcMessageForTurn(
            generalMeta.npcmsg ?? generalMeta.text,
            this.rng,
            this.aiConst.npcMessageFreqByDay,
            this.turnTermMinutes
        );

        if (this.general.npcState >= 2) {
            this.general.meta = { ...this.general.meta, defence_train: 80 };
        }

        if (this.general.officerLevel === 12 && this.generalPolicy.can('선양')) {
            const abdication = generalActionHandlers['선양']?.(this);
            if (abdication) {
                return abdication;
            }
        }

        if (this.general.npcState === 5) {
            if (this.general.nationId === 0) {
                this.general.meta = { ...this.general.meta, killturn: 1 };
                return { action: reservedTurn.action, args: reservedTurn.args, reason: '사망' };
            }
            const result = generalActionHandlers['집합']?.(this);
            return result ?? this.buildGeneralCandidate(ACTION_REST, {}, 'npc_troop');
        }

        if (reservedTurn.action !== ACTION_REST) {
            return { action: reservedTurn.action, args: reservedTurn.args, reason: 'do예약턴' };
        }

        if (
            readMetaNumber(asRecord(this.general.meta), 'injury', this.general.injury) > this.nationPolicy.cureThreshold
        ) {
            return { action: 'che_요양', args: {}, reason: 'do요양' };
        }

        if ([2, 3].includes(this.general.npcState) && this.general.nationId === 0) {
            const rebellion = generalActionHandlers['거병']?.(this);
            if (rebellion) {
                return rebellion;
            }
        }

        if (this.general.nationId === 0 && this.generalPolicy.can('국가선택')) {
            const pickNation = generalActionHandlers['국가선택']?.(this);
            if (pickNation) {
                return pickNation;
            }
            const neutral = generalActionHandlers['중립']?.(this);
            return neutral ?? this.buildGeneralCandidate(ACTION_REST, {}, 'neutral');
        }

        if (this.general.npcState < 2 && this.general.nationId === 0 && !this.generalPolicy.can('국가선택')) {
            return { action: reservedTurn.action, args: reservedTurn.args, reason: '재야유저' };
        }

        if (this.general.npcState >= 2 && this.general.officerLevel === 12 && !this.nation?.capitalCityId) {
            const worldMeta = asRecord(this.world.meta);
            const initYear = readNumber(worldMeta.initYear, this.scenarioMeta?.startYear ?? this.startYear);
            const initMonth = readNumber(worldMeta.initMonth, 1);
            const relYearMonth =
                joinYearMonth(this.world.currentYear, this.world.currentMonth) - joinYearMonth(initYear, initMonth);
            if (relYearMonth > 1) {
                const establish = generalActionHandlers['건국']?.(this);
                if (establish) {
                    return establish;
                }
            }
            const move = generalActionHandlers['방랑군이동']?.(this);
            if (move) {
                return move;
            }
            if (relYearMonth > 1) {
                const disband = generalActionHandlers['해산']?.(this);
                if (disband) {
                    return disband;
                }
            }
        }

        for (const actionName of this.generalPolicy.priority) {
            const allowed = this.generalPolicy.can(actionName);
            if (!allowed) {
                if ((process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(this.general.id))) {
                    process.stdout.write(
                        `AI_GENERAL_PRIORITY_TRACE ${JSON.stringify({ generalId: this.general.id, actionName, allowed, result: null })}\n`
                    );
                }
                continue;
            }
            const handler = generalActionHandlers[actionName];
            if (!handler) {
                continue;
            }
            const result = handler(this);
            if ((process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(this.general.id))) {
                process.stdout.write(
                    `AI_GENERAL_PRIORITY_TRACE ${JSON.stringify({ generalId: this.general.id, actionName, allowed, result })}\n`
                );
            }
            if (result) {
                return result;
            }
        }

        const neutral = generalActionHandlers['중립']?.(this);
        return neutral ?? this.buildGeneralCandidate(ACTION_REST, {}, 'neutral');
    }

    getDebugState(): GeneralAiDebugState {
        this.categorizeNationCities();
        const yearMonth = joinYearMonth(this.world.currentYear, this.world.currentMonth);
        const startYearMonth = joinYearMonth(this.startYear + 2, 5);
        const meta = asRecord(this.nation?.meta ?? {});
        const lastAttackable = readMetaNumber(meta, 'last_attackable', 0);

        return {
            generalId: this.general.id,
            nationId: this.nation?.id ?? null,
            cityId: this.city?.id ?? null,
            yearMonth,
            startYear: this.startYear,
            startYearMonth,
            dipState: this.dipState,
            attackable: this.attackable,
            warTargetNation: { ...this.warTargetNation },
            genType: this.genType,
            lastAttackable,
            frontCities: Object.values(this.frontCities).map((city) => ({
                id: city.id,
                frontState: city.frontState,
                supplyState: city.supplyState,
            })),
            supplyCities: Object.values(this.supplyCities).map((city) => ({
                id: city.id,
                frontState: city.frontState,
                supplyState: city.supplyState,
            })),
            policy: {
                minAvailableRecruitPop: this.aiConst.minAvailableRecruitPop,
                minNpcWarLeadership: this.nationPolicy.minNpcWarLeadership,
                minWarCrew: this.nationPolicy.minWarCrew,
                cureThreshold: this.nationPolicy.cureThreshold,
            },
        };
    }

    buildGeneralCandidate(action: string, args: Record<string, unknown>, reason: string): AiCommandCandidate | null {
        return this.buildCandidate(this.generalDefinitions, this.generalFallback, action, args, reason);
    }

    buildNationCandidate(action: string, args: Record<string, unknown>, reason: string): AiCommandCandidate | null {
        return this.buildCandidate(this.nationDefinitions, this.nationFallback, action, args, reason);
    }

    getLastNationTurn(): Record<string, unknown> {
        return asRecord(asRecord(this.nation?.meta)[`turn_last_${this.general.officerLevel}`]);
    }

    getLastCapitalMoveTrial(): [number, number] | null {
        const raw = asRecord(this.nation?.meta).lastCapitalMoveTrial;
        if (!Array.isArray(raw) || raw.length < 2) return null;
        const officerLevel = Number(raw[0]);
        const turnTick = Number(raw[1]);
        return Number.isFinite(officerLevel) && Number.isFinite(turnTick) ? [officerLevel, turnTick] : null;
    }

    markCapitalMoveTrial(): void {
        if (!this.nation || this.general.turnTick === undefined) return;
        this.patchPersistentNationMeta({
            lastCapitalMoveTrial: [this.general.officerLevel, this.general.turnTick],
        });
    }

    patchPersistentNationMeta(patch: Record<string, unknown>): void {
        if (!this.nation) return;
        const nextMeta = {
            ...(this.promotionNationMeta ?? this.nation.meta),
            ...patch,
        };
        this.nation = { ...this.nation, meta: nextMeta as Nation['meta'] };
        this.promotionNationMeta = nextMeta;
    }

    getFirstReservedGeneralTurn(generalId: number): ReservedTurnEntry {
        return this.reservedTurnProvider.getGeneralTurn(generalId, 0);
    }

    hasFirstReservedGeneralRecruitmentTurn(generalId: number): boolean {
        const action = this.getFirstReservedGeneralTurn(generalId).action;
        // Ref checks `instanceof che_징병`; che_모병 inherits che_징병 there.
        // Core persists the concrete command key, so preserve that subtype
        // relationship explicitly at the serialized reserved-turn boundary.
        return action === 'che_징병' || action === 'che_모병';
    }

    resolveGeneralAiStats(general: TurnGeneral): ReturnType<typeof resolveLegacyAiStats> {
        if (this.commandEnv.generalActionModules) {
            return resolveLegacyAiStatsWithModules(
                general,
                this.nation,
                this.commandEnv.maxStatLevel ?? LEGACY_DEFAULT_MAX_LEVEL,
                this.commandEnv.generalActionModules,
                this.worldRef,
                this.world,
                this.startYear,
                this.commandEnv.maxTechLevel
            );
        }
        return resolveLegacyAiStats(general, this.nation, this.commandEnv.maxStatLevel ?? LEGACY_DEFAULT_MAX_LEVEL);
    }

    calculateRecruitPopulationScore(general: TurnGeneral): number {
        const pipeline = new GeneralActionPipeline(this.commandEnv.generalActionModules ?? []);
        return pipeline.onCalcDomestic(
            {
                general,
                nation: this.nation,
                ...(this.worldRef
                    ? {
                          worldView: {
                              listGenerals: () => this.worldRef!.listGenerals(),
                              listGeneralsByCity: (cityId: number) =>
                                  this.worldRef!.listGenerals().filter((candidate) => candidate.cityId === cityId),
                              listNations: () => this.worldRef!.listNations(),
                          },
                      }
                    : {}),
                time: {
                    year: this.world.currentYear,
                    month: this.world.currentMonth,
                    startYear: this.startYear,
                },
                maxTechLevel: this.commandEnv.maxTechLevel,
            },
            '징집인구',
            'score',
            100
        );
    }

    calcNationDevelopedRate(): Record<string, number> {
        if (this.devRate) {
            return this.devRate;
        }
        this.categorizeNationCities();
        const devRate: Record<string, number> = { all: 0 };
        const cities = Object.values(this.supplyCities);
        if (cities.length === 0) {
            this.devRate = devRate;
            return devRate;
        }

        for (const city of cities) {
            const entries = this.calcCityDevelRate(city);
            for (const [key, [score]] of Object.entries(entries)) {
                if (key === 'trust') {
                    continue;
                }
                devRate[key] = (devRate[key] ?? 0) + score;
                devRate.all += score;
            }
        }
        for (const key of Object.keys(devRate)) {
            devRate[key] /= cities.length;
        }
        devRate.all /= Math.max(1, Object.keys(devRate).length - 1);
        this.devRate = devRate;
        return devRate;
    }

    calcCityDevelRate(city: City): Record<string, [number, number]> {
        const trust = readMetaNumber(asRecord(city.meta), 'trust', 0) / 100;
        return {
            trust: [trust, t통솔장],
            pop: [city.populationMax > 0 ? city.population / city.populationMax : 0, t통솔장],
            agri: [city.agricultureMax > 0 ? city.agriculture / city.agricultureMax : 0, t지장],
            comm: [city.commerceMax > 0 ? city.commerce / city.commerceMax : 0, t지장],
            secu: [city.securityMax > 0 ? city.security / city.securityMax : 0, t무장],
            def: [city.defenceMax > 0 ? city.defence / city.defenceMax : 0, t무장],
            wall: [city.wallMax > 0 ? city.wall / city.wallMax : 0, t무장],
        };
    }

    calcWarRoute(): void {
        if (this.warRoute || !this.map || !this.worldRef) {
            return;
        }
        const target = Object.keys(this.warTargetNation).map((key) => Number(key));
        if (this.nation) {
            target.push(this.nation.id);
        }
        this.warRoute = searchAllDistanceByNationList(this.map, this.worldRef.listCities(), target, false);
    }

    categorizeNationCities(): void {
        if (this.categorizedCities) {
            return;
        }
        this.categorizedCities = true;

        if (!this.nation || !this.worldRef) {
            return;
        }

        const nationId = this.nation.id;
        const nationCities: Record<
            number,
            City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
        > = {};
        const frontCities: Record<
            number,
            City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
        > = {};
        const supplyCities: Record<
            number,
            City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
        > = {};
        const backupCities: Record<
            number,
            City & { dev: number; important: number; generals?: Record<number, TurnGeneral> }
        > = {};

        for (const city of this.worldRef.listCities()) {
            if (city.nationId !== nationId) {
                continue;
            }
            const max = city.agricultureMax + city.commerceMax + city.securityMax + city.defenceMax + city.wallMax;
            const dev =
                max > 0 ? (city.agriculture + city.commerce + city.security + city.defence + city.wall) / max : 0;
            const entry = { ...city, dev, important: 1, generals: {} as Record<number, TurnGeneral> };
            nationCities[city.id] = entry;
            if (city.supplyState > 0) {
                supplyCities[city.id] = entry;
                if (city.frontState <= 0) {
                    backupCities[city.id] = entry;
                }
            }
            if (city.frontState > 0) {
                frontCities[city.id] = entry;
            }
        }

        this.nationCities = nationCities;
        this.frontCities = frontCities;
        this.supplyCities = supplyCities;
        this.backupCities = backupCities;
    }

    categorizeNationGeneral(): void {
        if (this.categorizedGenerals) {
            return;
        }
        this.categorizedGenerals = true;

        if (!this.nation || !this.worldRef) {
            return;
        }

        this.categorizeNationCities();

        const nationId = this.nation.id;
        const nationGenerals = this.worldRef
            .listGenerals()
            .filter((general) => general.nationId === nationId && general.id !== this.general.id);

        const userGenerals: Record<number, TurnGeneral> = {};
        const userCivilGenerals: Record<number, TurnGeneral> = {};
        const userWarGenerals: Record<number, TurnGeneral> = {};
        const lostGenerals: Record<number, TurnGeneral> = {};
        const npcCivilGenerals: Record<number, TurnGeneral> = {};
        const npcWarGenerals: Record<number, TurnGeneral> = {};
        const troopLeaders: Record<number, TurnGeneral> = {};
        const chiefGenerals: Record<number, TurnGeneral> = {};

        let lastWar = Number.MAX_SAFE_INTEGER;
        for (const candidate of nationGenerals) {
            const belong = readMetaNumber(asRecord(candidate.meta), 'belong', 0);
            const recentWarTurn = this.calcRecentWarTurn(candidate);
            if (belong > 0 && recentWarTurn >= (belong - 1) * 12) {
                continue;
            }
            lastWar = Math.min(lastWar, recentWarTurn);
        }

        for (const candidate of nationGenerals) {
            const officerLevel = candidate.officerLevel;
            const npcType = candidate.npcState;
            const officerCity = readMetaNumber(
                asRecord(candidate.meta),
                'officer_city',
                readMetaNumber(asRecord(candidate.meta), 'officerCity', 0)
            );

            if (officerLevel > 4) {
                chiefGenerals[officerLevel] = candidate;
            } else if (officerLevel >= 2 && officerCity > 0 && this.nationCities[officerCity]) {
                this.nationCities[officerCity].important += 1;
            }

            const cityId = candidate.cityId;
            const city = this.nationCities[cityId];
            if (city) {
                city.generals ??= {};
                city.generals[candidate.id] = candidate;
                if (city.supplyState <= 0) {
                    lostGenerals[candidate.id] = candidate;
                }
            } else {
                lostGenerals[candidate.id] = candidate;
            }

            const isTroopLeader =
                npcType === 5 ||
                (candidate.troopId === candidate.id &&
                    this.getFirstReservedGeneralTurn(candidate.id).action === 'che_집합');
            if (isTroopLeader) {
                troopLeaders[candidate.id] = candidate;
                continue;
            }

            const killturn = readRequiredMetaNumber(asRecord(candidate.meta), 'killturn', `generalId=${candidate.id}`);
            if (killturn <= 5) {
                npcCivilGenerals[candidate.id] = candidate;
                continue;
            }

            if (npcType < 2) {
                userGenerals[candidate.id] = candidate;
                const recentWarTurn = this.calcRecentWarTurn(candidate);
                if (recentWarTurn <= lastWar + 12) {
                    userWarGenerals[candidate.id] = candidate;
                } else if (this.dipState !== d평화 && candidate.crew >= this.nationPolicy.minWarCrew) {
                    userWarGenerals[candidate.id] = candidate;
                } else {
                    userCivilGenerals[candidate.id] = candidate;
                }
                continue;
            }

            const fullLeadership = this.resolveGeneralAiStats(candidate).fullLeadership;
            if (fullLeadership >= this.nationPolicy.minNpcWarLeadership) {
                npcWarGenerals[candidate.id] = candidate;
            } else {
                npcCivilGenerals[candidate.id] = candidate;
            }
        }

        this.nationGenerals = nationGenerals;
        this.userGenerals = userGenerals;
        this.userCivilGenerals = userCivilGenerals;
        this.userWarGenerals = userWarGenerals;
        this.lostGenerals = lostGenerals;
        this.npcCivilGenerals = npcCivilGenerals;
        this.npcWarGenerals = npcWarGenerals;
        this.troopLeaders = troopLeaders;
        this.chiefGenerals = chiefGenerals;
    }

    private updateInstance(): void {
        if (!this.reqUpdateInstance) {
            return;
        }
        this.reqUpdateInstance = false;

        const refreshedGeneral = this.worldRef?.getGeneralById(this.general.id);
        if (refreshedGeneral) {
            this.general = { ...refreshedGeneral, meta: { ...refreshedGeneral.meta } };
        }
        const refreshedCity = this.worldRef?.getCityById(this.general.cityId);
        if (refreshedCity) {
            this.city = refreshedCity;
        }
        const refreshedNation =
            this.general.nationId > 0 ? (this.worldRef?.getNationById(this.general.nationId) ?? null) : null;
        if (refreshedNation !== undefined) {
            this.nation = refreshedNation ? { ...refreshedNation, meta: { ...refreshedNation.meta } } : refreshedNation;
        }

        const nation =
            this.nation ??
            ({
                id: 0,
                name: '재야',
                color: '#000000',
                capitalCityId: null,
                chiefGeneralId: null,
                gold: 0,
                rice: 0,
                power: 0,
                level: 0,
                typeCode: 'neutral',
                meta: {},
            } satisfies Nation);

        const baseDevelCost = this.commandEnv.develCost * 12;
        const nationMeta = asRecord(nation.meta);
        const prevIncomeGold = readMetaNumber(nationMeta, 'prev_income_gold', 1000);
        const prevIncomeRice = readMetaNumber(nationMeta, 'prev_income_rice', 1000);
        const elapsedYears = this.world.currentYear - this.startYear - 3;
        const maxCandidate = Math.max(
            this.nationPolicy.minimumResourceActionAmount,
            prevIncomeGold / 10,
            prevIncomeRice / 10,
            nation.gold / 5,
            nation.rice / 5,
            elapsedYears * 1000
        );
        this.maxResourceActionAmount = valueFit(
            roundTo(maxCandidate, -2),
            null,
            this.nationPolicy.maximumResourceActionAmount
        );
        if (this.maxResourceActionAmount > this.aiConst.maxResourceActionAmount) {
            this.maxResourceActionAmount = this.aiConst.maxResourceActionAmount;
        }

        this.calcDiplomacyState();
        this.refreshLegacyFullStats();
        this.genType = this.calcGenType();

        void baseDevelCost;
    }

    private buildCandidate(
        definitions: Map<string, GeneralActionDefinition>,
        fallback: GeneralActionDefinition,
        action: string,
        args: Record<string, unknown>,
        reason: string
    ): AiCommandCandidate | null {
        const definition = definitions.get(action) ?? fallback;
        const parsedArgs = definition.parseArgs(args);
        if (parsedArgs === null) {
            return null;
        }
        const constraintArgs = withCanonicalArgumentAliases(parsedArgs as Record<string, unknown>);
        const constraintEnv = this.buildConstraintEnv();
        const ctx: ConstraintContext = {
            actorId: this.general.id,
            cityId: this.city?.id,
            nationId: this.general.nationId,
            args: constraintArgs,
            env: constraintEnv,
            mode: 'full',
        };
        const view = new WorldStateView(this.worldRef, constraintEnv, constraintArgs, {
            general: this.general,
            city: this.city,
            nation: this.nation ?? null,
        });
        const constraints = definition.buildConstraints(ctx, parsedArgs as never);
        const result = evaluateConstraints(constraints, ctx, view);
        if (result.kind !== 'allow') {
            if ((process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(this.general.id))) {
                process.stdout.write(
                    `AI_GENERAL_CONSTRAINT_TRACE ${JSON.stringify({ generalId: this.general.id, action, args: parsedArgs, result })}\n`
                );
            }
            return null;
        }
        return {
            action: definition.key,
            args: parsedArgs as Record<string, unknown>,
            reason,
        };
    }

    private buildConstraintEnv(): ConstraintEnv {
        return {
            ...this.env,
            cities: this.worldRef?.listCities() ?? [],
            nations: this.worldRef?.listNations() ?? [],
            map: this.map,
            unitSet: this.unitSet,
        };
    }

    private calcGenType(): number {
        const meta = asRecord(this.general.meta);
        const leadership = readMetaNumber(meta, 'fullLeadership', this.general.stats.leadership);
        const strength = Math.max(readMetaNumber(meta, 'fullStrength', this.general.stats.strength), 1);
        const intel = Math.max(readMetaNumber(meta, 'fullIntelligence', this.general.stats.intelligence), 1);
        let genType: number;

        if (strength >= intel) {
            genType = t무장;
            if (intel >= strength * 0.8) {
                if (this.rng.nextBool(intel / strength / 2)) {
                    genType |= t지장;
                }
            }
        } else {
            genType = t지장;
            if (strength >= intel * 0.8) {
                if (this.rng.nextBool(strength / intel / 2)) {
                    genType |= t무장;
                }
            }
        }

        if (leadership >= this.nationPolicy.minNpcWarLeadership) {
            genType |= t통솔장;
        }

        return genType;
    }

    private refreshLegacyFullStats(): void {
        const stats = this.resolveGeneralAiStats(this.general);
        this.general.meta = {
            ...this.general.meta,
            ...stats,
        };
    }

    private chooseNpcPromotion(): void {
        if (!this.nation || !this.worldRef) {
            return;
        }
        const minChiefLevel = this.nation.level >= 6 ? 5 : this.nation.level >= 4 ? 7 : this.nation.level >= 2 ? 9 : 11;
        let chiefSet = readMetaNumber(asRecord(this.nation.meta), 'chief_set', 0);
        const initialChiefSet = chiefSet;
        const generals = this.worldRef
            .listGenerals()
            .filter((candidate) => candidate.nationId === this.nation!.id)
            .sort((left, right) => {
                const leftScore = left.stats.leadership * 2 + left.stats.strength + left.stats.intelligence;
                const rightScore = right.stats.leadership * 2 + right.stats.strength + right.stats.intelligence;
                // Ref's nation query returns primary-key order and uasort keeps
                // that order when the raw-stat score ties.
                return rightScore - leftScore || left.id - right.id;
            });
        const effectiveOfficerLevel = new Map(generals.map((candidate) => [candidate.id, candidate.officerLevel]));

        let userChiefCount = 0;
        const worldKillturn = readMetaNumber(asRecord(this.world.meta), 'killturn', 0);
        const minUserKillturn = worldKillturn - Math.trunc(240 / this.turnTermMinutes);
        const minNpcKillturn = 36;

        for (let chiefLevel = minChiefLevel; chiefLevel <= 12; chiefLevel += 1) {
            const chief = this.chiefGenerals[chiefLevel];
            if (!chief || chief.id === this.general.id) {
                continue;
            }
            const penalty = asRecord(chief.penalty);
            const killturn = readRequiredMetaNumber(asRecord(chief.meta), 'killturn', `generalId=${chief.id}`);
            if (chief.npcState < 2 && killturn >= minUserKillturn && penalty.noAmbassador !== true) {
                userChiefCount += 1;
                chief.meta = { ...chief.meta, permission: 'ambassador' };
                this.promotionPatches.push({
                    generalId: chief.id,
                    officerLevel: chief.officerLevel,
                    officerCity: readMetaNumber(asRecord(chief.meta), 'officer_city', 0),
                    permission: 'ambassador',
                });
            }
        }

        const minBelong = Math.min(readMetaNumber(asRecord(this.general.meta), 'belong', 0) - 1, 3);
        const availableUserChiefCount = Object.values(this.userGenerals).filter((candidate) => {
            if (candidate.id === this.general.id) {
                return false;
            }
            const penalty = asRecord(candidate.penalty);
            const killturn = readRequiredMetaNumber(asRecord(candidate.meta), 'killturn', `generalId=${candidate.id}`);
            return (
                killturn >= minUserKillturn &&
                readMetaNumber(asRecord(candidate.meta), 'belong', 0) >= minBelong &&
                penalty.noChief !== true
            );
        }).length;

        if (userChiefCount === 0 && availableUserChiefCount > 0 && (chiefSet & (1 << 11)) === 0) {
            const userCandidates = Object.values(this.userGenerals)
                .filter((candidate) => candidate.id !== this.general.id)
                .sort((left, right) => {
                    const leftPenalty = asRecord(left.penalty);
                    const rightPenalty = asRecord(right.penalty);
                    if ((leftPenalty.noChief === true) !== (rightPenalty.noChief === true)) {
                        return leftPenalty.noChief === true ? 1 : -1;
                    }
                    if ((leftPenalty.noAmbassador === true) !== (rightPenalty.noAmbassador === true)) {
                        return leftPenalty.noAmbassador === true ? 1 : -1;
                    }
                    return right.stats.leadership - left.stats.leadership;
                });
            for (const candidate of userCandidates) {
                const penalty = asRecord(candidate.penalty);
                const killturn = readRequiredMetaNumber(
                    asRecord(candidate.meta),
                    'killturn',
                    `generalId=${candidate.id}`
                );
                if (
                    penalty.noChief === true ||
                    killturn < minUserKillturn ||
                    readMetaNumber(asRecord(candidate.meta), 'belong', 0) < minBelong ||
                    candidate.officerLevel > 4
                ) {
                    continue;
                }
                const permission = penalty.noAmbassador === true ? undefined : 'ambassador';
                candidate.officerLevel = 11;
                candidate.meta = {
                    ...candidate.meta,
                    officer_city: 0,
                    ...(permission ? { permission } : {}),
                };
                this.promotionPatches.push({
                    generalId: candidate.id,
                    officerLevel: 11,
                    officerCity: 0,
                    ...(permission ? { permission } : {}),
                });
                effectiveOfficerLevel.set(candidate.id, 11);
                chiefSet |= 1 << 11;
                userChiefCount += 1;
                break;
            }
        }

        for (let chiefLevel = 11; chiefLevel >= minChiefLevel; chiefLevel -= 1) {
            if ((chiefSet & (1 << chiefLevel)) !== 0 || this.general.officerLevel === chiefLevel) {
                continue;
            }
            const oldChief = generals.find((candidate) => candidate.officerLevel === chiefLevel);
            if (oldChief) {
                const oldChiefKillturn = readRequiredMetaNumber(
                    asRecord(oldChief.meta),
                    'killturn',
                    `generalId=${oldChief.id}`
                );
                if (oldChief.npcState < 2 && oldChiefKillturn >= minChiefLevel) {
                    continue;
                }
                const newChiefProbability = this.rng.nextBool(0.1) ? 1 : 0;
                // GeneralAI.php performs a second nextBool(0) call on the
                // rejection path. Preserve that consumption for the shared
                // nation/general AI RNG stream.
                if (newChiefProbability < 1 && !this.rng.nextBool(newChiefProbability)) {
                    continue;
                }
            }
            const nextChief = generals.find((candidate) => {
                if (candidate.id === this.general.id) {
                    return false;
                }
                if ((effectiveOfficerLevel.get(candidate.id) ?? candidate.officerLevel) > 4) {
                    return false;
                }
                const killturn = readRequiredMetaNumber(
                    asRecord(candidate.meta),
                    'killturn',
                    `generalId=${candidate.id}`
                );
                if (candidate.npcState < 2 && killturn < minUserKillturn) {
                    return false;
                }
                if (candidate.npcState >= 2 && killturn < minNpcKillturn) {
                    return false;
                }
                if (asRecord(candidate.penalty).noChief === true) {
                    return false;
                }
                if (chiefLevel !== 11 && chiefLevel % 2 === 0 && candidate.stats.strength < this.aiConst.chiefStatMin) {
                    return false;
                }
                if (
                    chiefLevel !== 11 &&
                    chiefLevel % 2 === 1 &&
                    candidate.stats.intelligence < this.aiConst.chiefStatMin
                ) {
                    return false;
                }
                if (candidate.npcState < 2 && userChiefCount >= 3) {
                    return false;
                }
                return true;
            });
            if (!nextChief) {
                continue;
            }
            if (oldChief) {
                this.promotionPatches.push({ generalId: oldChief.id, officerLevel: 1, officerCity: 0 });
            }
            const permission =
                nextChief.npcState < 2 && asRecord(nextChief.penalty).noAmbassador !== true ? 'ambassador' : undefined;
            if (nextChief.npcState < 2) {
                userChiefCount += 1;
            }
            this.promotionPatches.push({
                generalId: nextChief.id,
                officerLevel: chiefLevel,
                officerCity: 0,
                ...(permission ? { permission } : {}),
            });
            if (process.env.CORE_AI_TRACE_SEQUENCE === '1') {
                process.stdout.write(
                    `AI_PROMOTION_TRACE ${JSON.stringify({ engine: 'core', mode: 'lord', actor: this.general.id, chiefLevel, picked: nextChief.id })}\n`
                );
            }
            nextChief.meta = {
                ...nextChief.meta,
                officer_city: 0,
                ...(permission ? { permission } : {}),
            };
            effectiveOfficerLevel.set(nextChief.id, chiefLevel);
            chiefSet |= 1 << chiefLevel;
        }

        if (chiefSet !== initialChiefSet) {
            this.promotionNationMeta = {
                ...this.nation.meta,
                ...(this.promotionNationMeta ?? {}),
                chief_set: chiefSet,
            };
        }
    }

    private chooseNonLordPromotion(): void {
        if (!this.nation) {
            return;
        }
        const minChiefLevel = this.nation.level >= 6 ? 5 : this.nation.level >= 4 ? 7 : this.nation.level >= 2 ? 9 : 11;
        let chiefSet = readMetaNumber(asRecord(this.nation.meta), 'chief_set', 0);
        const pools = [this.npcWarGenerals, this.npcCivilGenerals, this.userWarGenerals, this.userCivilGenerals];

        for (let chiefLevel = minChiefLevel; chiefLevel <= 12; chiefLevel += 1) {
            if (
                (chiefSet & (1 << chiefLevel)) !== 0 ||
                this.chiefGenerals[chiefLevel] ||
                this.general.officerLevel === chiefLevel
            ) {
                continue;
            }

            let picked: TurnGeneral | null = null;
            for (let trial = 0; trial < 5; trial += 1) {
                const pool = pools.find((candidatePool) => Object.keys(candidatePool).length > 0);
                if (!pool) {
                    break;
                }
                const candidate = this.rng.choice(Object.values(pool));
                if (candidate.officerLevel !== 1) {
                    continue;
                }
                if (
                    chiefLevel !== 11 &&
                    ((chiefLevel % 2 === 0 && candidate.stats.strength < this.aiConst.chiefStatMin) ||
                        (chiefLevel % 2 === 1 && candidate.stats.intelligence < this.aiConst.chiefStatMin))
                ) {
                    continue;
                }
                picked = candidate;
                break;
            }
            if (!picked) {
                continue;
            }

            picked.officerLevel = chiefLevel;
            picked.meta = { ...picked.meta, officer_city: 0 };
            this.promotionPatches.push({ generalId: picked.id, officerLevel: chiefLevel, officerCity: 0 });
            if (process.env.CORE_AI_TRACE_SEQUENCE === '1') {
                process.stdout.write(
                    `AI_PROMOTION_TRACE ${JSON.stringify({ engine: 'core', mode: 'non-lord', actor: this.general.id, chiefLevel, picked: picked.id })}\n`
                );
            }
            this.chiefGenerals[chiefLevel] = picked;
            chiefSet |= 1 << chiefLevel;
        }

        if (this.promotionPatches.length > 0) {
            this.promotionNationMeta = { ...this.nation.meta, chief_set: chiefSet };
        }
    }

    private calcDiplomacyState(): void {
        if (!this.nation || !this.worldRef) {
            return;
        }
        const nationId = this.nation.id;
        const yearMonth = joinYearMonth(this.world.currentYear, this.world.currentMonth);
        const startYearMonth = joinYearMonth(this.startYear + 2, 5);

        const warTargets = this.worldRef
            .listDiplomacy()
            .filter((entry) => entry.fromNationId === nationId && (entry.state === 0 || entry.state === 1));

        if (yearMonth <= startYearMonth) {
            this.dipState = warTargets.length === 0 ? d평화 : d선포;
            this.attackable = false;
            return;
        }

        const frontStatus = this.worldRef
            .listCities()
            .some((city) => city.nationId === nationId && city.supplyState > 0 && city.frontState > 0);
        this.attackable = frontStatus;

        let onWar = 0;
        let onWarReady = 0;
        const warTargetNation: Record<number, number> = {};
        for (const entry of warTargets) {
            if (entry.state === 0) {
                onWar += 1;
                warTargetNation[entry.toNationId] = 2;
            } else if (entry.state === 1 && entry.term < 5) {
                onWarReady += 1;
                warTargetNation[entry.toNationId] = 1;
            }
        }
        if (onWar === 0 && onWarReady === 0) {
            warTargetNation[0] = 1;
        }
        this.warTargetNation = warTargetNation;

        const declareTerms = warTargets.filter((entry) => entry.state === 1).map((entry) => entry.term);
        const minWarTerm = declareTerms.length > 0 ? Math.min(...declareTerms) : null;
        let worldLastAttackable = lastAttackableByWorld.get(this.world.meta);
        if (!worldLastAttackable) {
            worldLastAttackable = new Map();
            lastAttackableByWorld.set(this.world.meta, worldLastAttackable);
        }
        let lastAttackable =
            worldLastAttackable.get(nationId) ?? readMetaNumber(asRecord(this.nation.meta), 'last_attackable', 0);
        const markAttackable = () => {
            lastAttackable = yearMonth;
            worldLastAttackable.set(nationId, yearMonth);
            this.nation!.meta = { ...this.nation!.meta, last_attackable: yearMonth };
            // Ref writes nation_env.last_attackable while constructing each
            // GeneralAI instance. Carry that side effect through the existing
            // nation-meta patch channel even when no promotion was selected.
            // Promotion runs first in quarter months, so preserve a chief_set
            // patch already accumulated by choose*Promotion().
            this.promotionNationMeta = {
                ...(this.promotionNationMeta ?? this.nation!.meta),
                last_attackable: yearMonth,
            };
        };

        if (minWarTerm === null) {
            this.dipState = d평화;
        } else if (minWarTerm > 8) {
            this.dipState = d선포;
        } else if (minWarTerm > 5) {
            this.dipState = d징병;
        } else {
            this.dipState = d직전;
            markAttackable();
        }

        if (Object.prototype.hasOwnProperty.call(warTargetNation, 0) && this.attackable) {
            this.dipState = d전쟁;
            markAttackable();
        } else if (onWar > 0) {
            if (this.attackable) {
                this.dipState = d전쟁;
                markAttackable();
            } else if (lastAttackable >= yearMonth - 5) {
                this.dipState = d전쟁;
            }
        }

        // legacy GeneralAI.php 기준: 평화/선포 상태에서 병력 보유 여부로 d징병 전환하지 않음.
        if ((process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(this.general.id))) {
            process.stdout.write(
                `AI_DIPLOMACY_TRACE ${JSON.stringify({ generalId: this.general.id, warTargets, dipState: this.dipState })}\n`
            );
        }
    }

    private calcRecentWarTurn(general: TurnGeneral): number {
        return calculateRecentWarTurn(general, this.turnTermMinutes);
    }
}

export const shouldUseAi = (general: TurnGeneral, world: TurnWorldState): boolean => {
    if (general.npcState >= 2) {
        return true;
    }
    const meta = asRecord(general.meta);
    const limit = readMetaNumber(meta, 'autorun_limit', 0);
    if (limit <= 0) {
        return false;
    }
    const current = joinYearMonth(world.currentYear, world.currentMonth);
    return current < limit;
};

export const shouldUseNationAi = (general: TurnGeneral, world: TurnWorldState): boolean => {
    if (!shouldUseAi(general, world)) {
        return false;
    }
    if (general.npcState >= 2) {
        return true;
    }
    // Ref TurnExecutionHelper는 사용자 수뇌의 국가 AI에만 이 개인 설정을 적용한다.
    return readMetaNumber(asRecord(general.meta), 'use_auto_nation_turn', 1) !== 0;
};

export type { GeneralAIOptions, GeneralAiDebugState };
