import { readFile } from 'node:fs/promises';

import { ConstantRNG, RandUtil, type RandomGenerator } from '@sammo-ts/common';
import { describe, expect, it, vi } from 'vitest';

import { loadActionModuleBundle } from '../src/actionModules/bundle.js';
import {
    DOMESTIC_TRAIT_KEYS,
    EVENT_DOMESTIC_TRAIT_KEYS,
    loadDomesticTraitModules,
    loadEventDomesticTraitModules,
    loadWarTraitModules,
    WAR_TRAIT_KEYS,
} from '../src/actionModules/traits/index.js';
import { traitModule as rageTrait } from '../src/actionModules/traits/war/che_격노.js';
import { traitModule as recruitTrait } from '../src/actionModules/traits/war/che_징병.js';
import type { City, General, Nation } from '../src/domain/entities.js';
import {
    createItemActionModules,
    createItemModuleRegistry,
    ITEM_KEYS,
    loadItemModules,
} from '../src/items/index.js';
import { itemModule as defenceItem } from '../src/items/che_농성_주서음부.js';
import { itemModule as injuryItem } from '../src/items/che_부적_태현청생부.js';
import { itemModule as upperItem } from '../src/items/che_불굴_상편.js';
import { itemModule as intelligenceItem } from '../src/items/che_능력치_지력_이강주.js';
import { StrategyCommandResolver, type StrategyActionConfig, type StrategyContext } from '../src/actions/turn/general/strategyCommand.js';
import type { TurnCommandEnv } from '../src/actions/turn/commandEnv.js';
import { ActionLogger } from '../src/logging/actionLogger.js';
import { WarActionPipeline } from '../src/war/actions.js';
import { WarCrewType } from '../src/war/crewType.js';
import { createWarTriggerEnv } from '../src/war/triggers.js';
import { WarUnitGeneral } from '../src/war/units.js';
import type { WarEngineConfig } from '../src/war/types.js';
import { compileCrewTypeCatalog } from '../src/crewType/catalog.js';
import { createCrewTypeWarTriggerRegistry } from '../src/war/crewTypeTriggers.js';
import { parseUnitSetDefinition } from '../src/world/unitSet.js';

const config: WarEngineConfig = {
    armPerPhase: 500,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    maxTrainByWar: 110,
    maxAtmosByWar: 150,
    castleCrewTypeId: 1000,
    armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
};

const nation = (id: number): Nation => ({
    id,
    name: `감사국${id}`,
    color: '#000000',
    capitalCityId: id,
    chiefGeneralId: id,
    gold: 100_000,
    rice: 100_000,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: { tech: 0 },
});

const city = (id: number, nationId: number): City => ({
    id,
    name: `감사성${id}`,
    nationId,
    level: 1,
    state: 0,
    population: 10_000,
    populationMax: 20_000,
    agriculture: 1_000,
    agricultureMax: 2_000,
    commerce: 1_000,
    commerceMax: 2_000,
    security: 0,
    securityMax: 1,
    defence: 500,
    defenceMax: 500,
    wall: 500,
    wallMax: 500,
    supplyState: 0,
    frontState: 0,
    meta: {},
});

const general = (id: number, nationId: number, cityId: number, overrides: Partial<General> = {}): General => ({
    id,
    name: `감사장수${id}`,
    nationId,
    cityId,
    troopId: 0,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    experience: 0,
    dedication: 0,
    officerLevel: 5,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 100_000,
    rice: 100_000,
    crew: 1_000,
    crewTypeId: 1100,
    train: 100,
    atmos: 100,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    ...overrides,
});

const unitType = (id: number, name: string, armType = 1) =>
    new WarCrewType({
        id,
        name,
        armType,
        attack: 100,
        defence: 100,
        speed: 7,
        avoid: 10,
        magicCoef: 0,
        cost: 10,
        rice: 10,
        requirements: [],
        attackCoef: {},
        defenceCoef: {},
        info: [],
        initSkillTrigger: null,
        phaseSkillTrigger: null,
        iActionList: null,
    });

const buildUnit = (
    value: General,
    attacker: boolean,
    pipeline: WarActionPipeline = new WarActionPipeline([]),
    crew = unitType(value.crewTypeId, '보병')
): WarUnitGeneral =>
    new WarUnitGeneral(
        new RandUtil(new ConstantRNG(0)),
        config,
        value,
        city(value.cityId, value.nationId),
        nation(value.nationId),
        attacker,
        crew,
        new ActionLogger({ generalId: value.id, nationId: value.nationId }),
        pipeline
    );

const strategyConfig: StrategyActionConfig = {
    key: 'che_화계',
    name: '화계',
    statKey: 'intelligence',
    statExpKey: 'intel_exp',
    damageMode: 'fire',
    injuryGeneral: true,
};

const strategyEnv: TurnCommandEnv = {
    develCost: 100,
    trainDelta: 35,
    atmosDelta: 35,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    sabotageDefaultProb: 0.5,
    sabotageProbCoefByStat: 300,
    sabotageDefenceCoefByGeneralCount: 0,
    sabotageDamageMin: 10,
    sabotageDamageMax: 20,
    openingPartYear: 180,
    maxGeneral: 10,
    defaultNpcGold: 1_000,
    defaultNpcRice: 1_000,
    defaultCrewTypeId: 1100,
    defaultSpecialDomestic: null,
    defaultSpecialWar: null,
    initialNationGenLimit: 10,
    maxTechLevel: 12,
    baseGold: 1_000,
    baseRice: 1_000,
    maxResourceActionAmount: 1_000,
};

const strategyContext = (attacker: General, defender: General): StrategyContext => ({
    general: attacker,
    city: city(attacker.cityId, attacker.nationId),
    nation: nation(attacker.nationId),
    destCity: city(defender.cityId, defender.nationId),
    destNation: nation(defender.nationId),
    destGenerals: [defender],
    distance: 1,
    time: { year: 200, month: 1, startYear: 180 },
});

describe('hidche 효과 감사 회귀', () => {
    it('A01: 격노 특기와 구정신단경은 시도는 두 번, 발동은 한 번만 처리한다', async () => {
        const [item] = await loadItemModules(['che_격노_구정신단경']);
        const pipeline = new WarActionPipeline([
            rageTrait,
            ...createItemActionModules(createItemModuleRegistry([item!])).war,
        ]);
        const attacker = buildUnit(
            general(1, 1, 1, {
                role: {
                    personality: null,
                    specialDomestic: null,
                    specialWar: 'che_격노',
                    items: { horse: null, weapon: null, book: null, item: 'che_격노_구정신단경' },
                },
            }),
            true,
            pipeline
        );
        const defender = buildUnit(general(2, 2, 2), false, pipeline);
        defender.activateSkill('필살');
        const rng = attacker.rng;
        const nextBool = vi.spyOn(rng, 'nextBool').mockReturnValue(true);
        vi.spyOn(attacker, 'criticalDamage').mockReturnValue(1.5);
        const multiply = vi.spyOn(attacker, 'multiplyWarPowerMultiply');

        pipeline
            .getBattlePhaseTriggerList(attacker.getActionContext())
            .fire({ rng, attacker, defender }, createWarTriggerEnv());

        expect(nextBool.mock.calls.map(([probability]) => probability)).toEqual([0.5, 0.5]);
        expect(multiply).toHaveBeenCalledExactlyOnceWith(1.5);
        expect(attacker.getMaxPhase()).toBe(8);
    });

    it('A02: 격노 비급은 특기와 독립된 두 번째 시도와 진노 판정을 유지한다', async () => {
        const [item] = await loadItemModules(['event_전투특기_격노']);
        const pipeline = new WarActionPipeline([
            rageTrait,
            ...createItemActionModules(createItemModuleRegistry([item!])).war,
        ]);
        const attacker = buildUnit(
            general(1, 1, 1, {
                role: {
                    personality: null,
                    specialDomestic: null,
                    specialWar: 'che_격노',
                    items: { horse: null, weapon: null, book: null, item: 'event_전투특기_격노' },
                },
            }),
            true,
            pipeline
        );
        const defender = buildUnit(general(2, 2, 2), false, pipeline);
        defender.activateSkill('회피');
        const nextBool = vi
            .spyOn(attacker.rng, 'nextBool')
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false);

        pipeline
            .getBattlePhaseTriggerList(attacker.getActionContext())
            .fire({ rng: attacker.rng, attacker, defender }, createWarTriggerEnv());

        expect(nextBool.mock.calls.map(([probability]) => probability)).toEqual([0.25, 0.25, 0.5]);
        expect(attacker.hasActivatedSkill('격노')).toBe(true);
    });

    it('A03: 실제 번들 조립에서 삼황내문이 목우 RNG보다 먼저 강제 저지한다', async () => {
        const raw = JSON.parse(
            await readFile(new URL('../../../resources/unitset/unitset_che.json', import.meta.url), 'utf8')
        ) as unknown;
        const unitSet = parseUnitSetDefinition(raw);
        const bundle = await loadActionModuleBundle(unitSet);
        const pipeline = new WarActionPipeline(bundle.war);
        const ramDefinition = unitSet.crewTypes!.find((entry) => entry.id === 1503)!;
        const defender = buildUnit(
            general(2, 2, 2, {
                crewTypeId: ramDefinition.id,
                role: {
                    personality: null,
                    specialDomestic: null,
                    specialWar: null,
                    items: { horse: null, weapon: null, book: null, item: 'che_저지_삼황내문' },
                },
            }),
            false,
            pipeline,
            new WarCrewType(ramDefinition)
        );
        const attacker = buildUnit(general(1, 1, 1), true, pipeline);
        const nextBool = vi.spyOn(defender.rng, 'nextBool');

        pipeline
            .getBattlePhaseTriggerList(defender.getActionContext())
            .fire({ rng: defender.rng, attacker, defender }, createWarTriggerEnv());

        expect(nextBool).not.toHaveBeenCalled();
        expect(defender.hasActivatedSkill('특수')).toBe(true);
        expect(defender.hasActivatedSkill('저지')).toBe(true);
    });

    it('A04: 상편은 부상·징병 특기·통솔 장비를 반영한 유효 통솔로 경계를 계산한다', async () => {
        const [leadershipItem] = await loadItemModules(['che_명마_12_옥란백용구']);
        const pipeline = new WarActionPipeline([
            recruitTrait,
            ...createItemActionModules(createItemModuleRegistry([leadershipItem!, upperItem])).war,
        ]);
        const value = general(1, 1, 1, {
            injury: 20,
            crew: 5_850,
            stats: { leadership: 100, strength: 70, intelligence: 70 },
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: 'che_징병',
                items: { horse: 'che_명마_12_옥란백용구', weapon: null, book: null, item: upperItem.key },
            },
        });
        const unit = buildUnit(value, true, pipeline);
        const oppose = buildUnit(general(2, 2, 2), false, pipeline);

        expect(unit.getComputedStat('leadership', value.stats.leadership)).toBe(117);
        expect(unit.getComputedStat('leadership', value.stats.leadership)).toBeGreaterThan(value.stats.leadership);
        pipeline
            .getBattlePhaseTriggerList(unit.getActionContext())
            .fire({ rng: unit.rng, attacker: unit, defender: oppose }, createWarTriggerEnv());
        expect(unit.getWarPowerMultiply()).toBeCloseTo(1.3, 12);
    });

    it('A05: 농성 아이템은 실제 대상 장수 컨텍스트의 계략 방어 훅을 사용한다', () => {
        const modules = createItemActionModules(createItemModuleRegistry([defenceItem])).general;
        const defender = general(2, 2, 2, {
            stats: { leadership: 0, strength: 0, intelligence: 0 },
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: defenceItem.key },
            },
        });
        const resolver = new StrategyCommandResolver(modules, strategyEnv, strategyConfig);

        expect(resolver.getProbability(strategyContext(general(1, 1, 1), defender)).defence).toBeCloseTo(0.3, 12);
    });

    it('A06: 태현청생부는 실제 대상 장수 컨텍스트의 계략 부상 훅을 사용한다', () => {
        const modules = createItemActionModules(createItemModuleRegistry([injuryItem])).general;
        const defender = general(2, 2, 2, {
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: injuryItem.key },
            },
        });
        const resolver = new StrategyCommandResolver(modules, strategyEnv, strategyConfig);
        const rng: RandomGenerator = {
            nextFloat1: () => 0,
            nextBool: (probability) => probability > 0,
            nextInt: (minInclusive) => minInclusive,
        };

        const result = resolver.resolve(strategyContext(general(1, 1, 1), defender), rng);

        expect(result.success).toBe(true);
        expect(result.injuryCount).toBe(0);
        expect(result.injuredGenerals).toEqual([]);
    });

    it('A07: 공격자와 각 방어자의 유효 능력치를 계산해 보정 후 최대값을 선택한다', () => {
        const modules = createItemActionModules(createItemModuleRegistry([intelligenceItem])).general;
        const attacker = general(1, 1, 1, {
            stats: { leadership: 70, strength: 0, intelligence: 70 },
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: intelligenceItem.key },
            },
        });
        const rawBest = general(2, 2, 2, { stats: { leadership: 70, strength: 0, intelligence: 90 } });
        const effectiveBest = general(3, 2, 2, {
            stats: { leadership: 70, strength: 0, intelligence: 85 },
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: intelligenceItem.key },
            },
        });
        const context = strategyContext(attacker, rawBest);
        context.destGenerals = [rawBest, effectiveBest];
        const resolver = new StrategyCommandResolver(modules, strategyEnv, strategyConfig);
        const probability = resolver.getProbability(context);

        expect(probability.attack).toBeCloseTo(80 / 300, 12);
        expect(probability.defence).toBeCloseTo(95 / 300, 12);
    });

    it('catalog: all shipped item and crew effect references resolve to executable contracts', async () => {
        const bundle = await loadActionModuleBundle();
        const items = await loadItemModules([...ITEM_KEYS]);
        const domesticTraits = await loadDomesticTraitModules([...DOMESTIC_TRAIT_KEYS]);
        const warTraits = await loadWarTraitModules([...WAR_TRAIT_KEYS]);
        const eventDomesticTraits = await loadEventDomesticTraitModules([...EVENT_DOMESTIC_TRAIT_KEYS]);
        const effectHooks = [
            'onCalcDomestic',
            'onCalcStat',
            'onCalcOpposeStat',
            'onCalcStrategic',
            'onCalcNationalIncome',
            'eventHandlers',
            'getPreTurnExecuteTriggerList',
            'getBattleInitTriggerList',
            'getBattlePhaseTriggerList',
            'getWarPowerMultiplier',
        ] as const;

        expect(items).toHaveLength(ITEM_KEYS.length);
        for (const item of [...items, ...domesticTraits, ...warTraits, ...eventDomesticTraits]) {
            expect(effectHooks.some((hook) => item[hook] !== undefined), item.key).toBe(true);
        }
        expect(bundle.general.length).toBeGreaterThan(0);
        expect(bundle.war.length).toBeGreaterThan(0);

        const raw = JSON.parse(
            await readFile(new URL('../../../resources/unitset/unitset_che.json', import.meta.url), 'utf8')
        ) as unknown;
        const unitSet = parseUnitSetDefinition(raw);
        const catalog = compileCrewTypeCatalog(unitSet, createCrewTypeWarTriggerRegistry());
        for (const definition of unitSet.crewTypes ?? []) {
            const compiled = catalog.byId.get(definition.id);
            expect(compiled, definition.name).toBeDefined();
            expect(compiled?.actions, definition.name).toHaveLength(definition.iActionList?.length ?? 0);
            for (const triggerKey of [
                ...(definition.initSkillTrigger ?? []),
                ...(definition.phaseSkillTrigger ?? []),
            ]) {
                expect(createCrewTypeWarTriggerRegistry()[triggerKey], `${definition.name}:${triggerKey}`).toBeTypeOf(
                    'function'
                );
            }
        }
    });
});
