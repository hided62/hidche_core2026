import { describe, expect, it } from 'vitest';
import { loadItemModules, type City, type General, type Nation } from '@sammo-ts/logic';
import { createRefOrderedActionStack } from '@sammo-ts/logic/actionModules/bundle.js';

import { GeneralAI, shouldUseNationAi } from '../src/turn/ai/generalAi.js';
import { canUseAutomatedNationAction, canUseRulerAutomation } from '../src/turn/ai/policies.js';
import type { TurnGeneral, TurnWorldState } from '../src/turn/types.js';
import {
    calculateRecentWarTurn,
    resolveLegacyAiStats,
    resolveLegacyAiStatsWithModules,
} from '../src/turn/ai/generalAi/core.js';
import { withCanonicalArgumentAliases } from '../src/turn/ai/aiUtils.js';
import { do일반내정, do전쟁내정 } from '../src/turn/ai/generalAi/general/devActions.js';
import { do금쌀구매 } from '../src/turn/ai/generalAi/general/economyActions.js';
import { do거병, do건국, do국가선택, do중립 } from '../src/turn/ai/generalAi/general/politicsActions.js';
import { do징병 } from '../src/turn/ai/generalAi/general/recruitActions.js';
import { doNPC헌납 } from '../src/turn/ai/generalAi/general/npcActions.js';
import { do전투준비, do출병 } from '../src/turn/ai/generalAi/general/warActions.js';
import { do내정워프, do전방워프, do집합, do후방워프 } from '../src/turn/ai/generalAi/general/warpActions.js';
import { doNPC몰수, doNPC포상, do유저장포상 } from '../src/turn/ai/generalAi/nation/rewards.js';
import { do천도 } from '../src/turn/ai/generalAi/nation/capital.js';
import { do선전포고 } from '../src/turn/ai/generalAi/nation/diplomacy.js';
import {
    doNPC구출발령,
    doNPC전방발령,
    doNPC후방발령,
} from '../src/turn/ai/generalAi/nation/assignments/npcAssignments.js';
import { do부대구출발령, do부대후방발령 } from '../src/turn/ai/generalAi/nation/assignments/troopAssignments.js';
import {
    do부대유저장후방발령,
    do유저장구출발령,
    do유저장전방발령,
    do유저장후방발령,
} from '../src/turn/ai/generalAi/nation/assignments/userAssignments.js';

type Candidate = {
    action: string;
    args: Record<string, unknown>;
    reason: string;
};

type ScriptedRng = {
    bools: boolean[];
    choices: unknown[];
    weightedChoices: Array<Record<string, number>>;
    weightedPairs: Array<Array<[unknown, number]>>;
    nextBool: (probability?: number) => boolean;
    nextFloat1: () => number;
    nextRangeInt: (min: number, max: number) => number;
    choice: <T>(items: T[] | Record<string, T>) => T;
    choiceUsingWeight: <T extends string | number>(items: Record<T, number>) => T;
    choiceUsingWeightPair: <T>(items: Array<[T, number]>) => T;
};

const makeRng = (bools: boolean[] = [], choices: unknown[] = []): ScriptedRng => {
    const scriptedChoices = [...choices];
    return {
        bools: [...bools],
        choices: scriptedChoices,
        weightedChoices: [],
        weightedPairs: [],
        nextBool() {
            return this.bools.shift() ?? false;
        },
        nextFloat1() {
            return 0;
        },
        nextRangeInt(min) {
            const picked = scriptedChoices.shift();
            return typeof picked === 'number' ? picked : min;
        },
        choice<T>(items: T[] | Record<string, T>): T {
            const values = Array.isArray(items) ? items : Object.values(items);
            const picked = scriptedChoices.shift();
            if (typeof picked === 'number' && Number.isInteger(picked) && picked >= 0 && picked < values.length) {
                return values[picked]!;
            }
            if (picked !== undefined && values.includes(picked as T)) {
                return picked as T;
            }
            return values[0]!;
        },
        choiceUsingWeight<T extends string | number>(items: Record<T, number>): T {
            this.weightedChoices.push(Object.fromEntries(Object.entries(items)) as Record<string, number>);
            return this.choice(
                Object.keys(items).map((key) => {
                    const numeric = Number(key);
                    return (Number.isNaN(numeric) ? key : numeric) as T;
                })
            );
        },
        choiceUsingWeightPair<T>(items: Array<[T, number]>): T {
            this.weightedPairs.push(items);
            const picked = scriptedChoices.shift();
            if (typeof picked === 'number' && Number.isInteger(picked) && picked >= 0 && picked < items.length) {
                return items[picked]![0];
            }
            return items[0]![0];
        },
    };
};

const singleActionModuleStack = (
    module: NonNullable<GeneralAI['commandEnv']['generalActionModules']>[number]
): NonNullable<GeneralAI['commandEnv']['generalActionModules']> => {
    const noOp = {};
    return createRefOrderedActionStack({
        nation: noOp,
        officer: noOp,
        domestic: noOp,
        war: noOp,
        personality: module,
        crewType: null,
        inheritance: noOp,
        scenario: null,
        items: [],
    });
};

const baseGeneral = (): General & { turnTime: Date } => ({
    id: 1,
    name: '가상장수',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    injury: 0,
    gold: 10_000,
    rice: 10_000,
    crew: 0,
    crewTypeId: 1,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 2,
    turnTime: new Date('0190-01-01T00:00:00Z'),
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 100, fullLeadership: 70 },
});

describe('GeneralAI recent war clock parity', () => {
    it('uses raw logical ticks at an exact turn boundary', () => {
        const general = {
            ...baseGeneral(),
            turnTick: 72_000_099,
            recentWarTick: 36_000_100,
            recentWarTime: new Date('0189-12-31T23:50:00.000Z'),
        } as ReturnType<typeof baseGeneral> & { turnTick: number; recentWarTick: number; recentWarTime: Date };

        expect(calculateRecentWarTurn(general, 10)).toBe(0);
    });
});

const baseCity = (): City => ({
    id: 1,
    name: '가상도시',
    nationId: 1,
    level: 5,
    state: 0,
    population: 100_000,
    populationMax: 100_000,
    agriculture: 10_000,
    agricultureMax: 10_000,
    commerce: 10_000,
    commerceMax: 10_000,
    security: 10_000,
    securityMax: 10_000,
    supplyState: 1,
    frontState: 0,
    defence: 10_000,
    defenceMax: 10_000,
    wall: 10_000,
    wallMax: 10_000,
    meta: { trust: 100, trade: 100 },
});

const baseNation = (): Nation => ({
    id: 1,
    name: '가상국',
    color: '#ffffff',
    capitalCityId: 1,
    chiefGeneralId: 1,
    gold: 100_000,
    rice: 100_000,
    power: 100,
    level: 1,
    typeCode: 'che_중립',
    meta: { tech: 0 },
});

const makeAi = (
    overrides: {
        general?: Partial<General>;
        city?: Partial<City>;
        nation?: Partial<Nation>;
        dipState?: number;
        attackable?: boolean;
        genType?: number;
        year?: number;
        startYear?: number;
        rng?: ScriptedRng;
        blockedActions?: string[];
        nations?: Nation[];
        generals?: General[];
        disabledPolicyActions?: string[];
        generalActionModules?: NonNullable<GeneralAI['commandEnv']['generalActionModules']>;
        reservedTurns?: Record<number, { action: string; args?: Record<string, unknown> }>;
    } = {}
): GeneralAI => {
    const general = {
        ...baseGeneral(),
        ...overrides.general,
        meta: { ...baseGeneral().meta, ...overrides.general?.meta },
    };
    const city = { ...baseCity(), ...overrides.city, meta: { ...baseCity().meta, ...overrides.city?.meta } };
    const nation = {
        ...baseNation(),
        ...overrides.nation,
        meta: { ...baseNation().meta, ...overrides.nation?.meta },
    };
    const rng = overrides.rng ?? makeRng();
    const blocked = new Set(overrides.blockedActions ?? []);
    const disabledPolicyActions = new Set(overrides.disabledPolicyActions ?? []);
    const nations = overrides.nations ?? [nation];
    const generals = overrides.generals ?? [general];
    const candidates: Candidate[] = [];

    return Object.assign(Object.create(GeneralAI.prototype), {
        general,
        city,
        nation,
        world: {
            id: 1,
            currentYear: overrides.year ?? 190,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0190-01-01T00:00:00Z'),
            meta: { seed: 1 },
        },
        worldRef: {
            listNations: () => nations,
            listGenerals: () => generals,
            listCities: () => [city],
            listTroops: () => [],
            listDiplomacy: () => [],
            getNationById: (id: number) => nations.find((item) => item.id === id) ?? null,
            getGeneralById: (id: number) => generals.find((item) => item.id === id) ?? null,
            getCityById: (id: number) => (city.id === id ? city : null),
            getTroopById: () => null,
            getDiplomacyEntry: () => null,
        },
        map: {
            id: 'test',
            name: 'test',
            cities: [
                {
                    id: 1,
                    name: '가상도시',
                    level: 5,
                    region: 1,
                    position: { x: 0, y: 0 },
                    connections: [2],
                    max: {
                        population: 100_000,
                        agriculture: 10_000,
                        commerce: 10_000,
                        security: 10_000,
                        defence: 10_000,
                        wall: 10_000,
                    },
                    initial: {
                        population: 100_000,
                        agriculture: 10_000,
                        commerce: 10_000,
                        security: 10_000,
                        defence: 10_000,
                        wall: 10_000,
                    },
                },
            ],
            defaults: { trust: 100, trade: 100, supplyState: 1, frontState: 0 },
        },
        unitSet: {
            id: 'test',
            name: 'test',
            defaultCrewTypeId: 1,
            crewTypes: [
                {
                    id: 1,
                    armType: 1,
                    name: '보병',
                    attack: 10,
                    defence: 10,
                    speed: 10,
                    avoid: 0,
                    magicCoef: 0,
                    cost: 10,
                    rice: 1,
                    requirements: [],
                    attackCoef: {},
                    defenceCoef: {},
                    info: [],
                    initSkillTrigger: null,
                    phaseSkillTrigger: null,
                    iActionList: null,
                },
            ],
        },
        scenarioConfig: {
            stat: { total: 300, min: 1, max: 100, npcTotal: 150, npcMax: 50, npcMin: 1, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'test' },
        },
        startYear: overrides.startYear ?? 180,
        commandEnv: {
            baseGold: 1000,
            baseRice: 1000,
            develCost: 10,
            maxResourceActionAmount: 10_000,
            minAvailableRecruitPop: 30_000,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            defaultCrewTypeId: 1,
            openingPartYear: 3,
            initialNationGenLimit: 10,
            maxTechLevel: 10,
            techLevelIncYear: 5,
            initialAllowedTechLevel: 1,
            generalActionModules: overrides.generalActionModules ?? [],
        },
        aiConst: {
            baseGold: 1000,
            baseRice: 1000,
            minAvailableRecruitPop: 30_000,
            maxResourceActionAmount: 10_000,
            minNationalGold: 1000,
            minNationalRice: 1000,
            defaultStatMax: 100,
            defaultStatNpcMax: 50,
            chiefStatMin: 70,
            npcMessageFreqByDay: 0,
            availableNationTypes: [],
        },
        dipState: overrides.dipState ?? 0,
        attackable: overrides.attackable ?? false,
        genType: overrides.genType ?? 7,
        rng,
        maxResourceActionAmount: 10_000,
        reservedTurnProvider: {
            getGeneralTurn: (generalId: number) => {
                const reserved = overrides.reservedTurns?.[generalId];
                return reserved ? { action: reserved.action, args: reserved.args ?? {} } : { action: '휴식', args: {} };
            },
        },
        generalPolicy: {
            can: (action: string) =>
                !disabledPolicyActions.has(action) && !['모병', '고급병종', '한계징병'].includes(action),
        },
        nationPolicy: {
            minWarCrew: 1500,
            minNpcRecruitCityPopulation: 30_000,
            safeRecruitCityPopulationRatio: 0.5,
            properWarTrainAtmos: 90,
            minimumResourceActionAmount: 1000,
            reqNationGold: 10_000,
            reqNationRice: 12_000,
            reqHumanWarRecommandGold: 20_000,
            reqHumanWarRecommandRice: 20_000,
            reqHumanDevelGold: 10_000,
            reqHumanDevelRice: 10_000,
            reqNpcWarGold: 10_000,
            reqNpcWarRice: 10_000,
            reqNpcDevelGold: 5_000,
            reqNpcDevelRice: 5_000,
        },
        calcCityDevelRate: (target: City) => ({
            trust: [Number(target.meta.trust ?? 0) / 100, 4],
            pop: [target.population / target.populationMax, 4],
            agri: [target.agriculture / target.agricultureMax, 2],
            comm: [target.commerce / target.commerceMax, 2],
            secu: [target.security / target.securityMax, 1],
            def: [target.defence / target.defenceMax, 1],
            wall: [target.wall / target.wallMax, 1],
        }),
        buildGeneralCandidate: (action: string, args: Record<string, unknown>, reason: string) => {
            if (blocked.has(action)) {
                return null;
            }
            const candidate = { action, args, reason };
            candidates.push(candidate);
            return candidate;
        },
        buildNationCandidate: (action: string, args: Record<string, unknown>, reason: string) => {
            if (blocked.has(action)) {
                return null;
            }
            const candidate = { action, args, reason };
            candidates.push(candidate);
            return candidate;
        },
    }) as GeneralAI;
};

const makePromotionGeneral = (overrides: Partial<TurnGeneral>): TurnGeneral => ({
    ...baseGeneral(),
    ...overrides,
    stats: { ...baseGeneral().stats, ...overrides.stats },
    meta: { ...baseGeneral().meta, belong: 1, ...overrides.meta },
});

const makeDeclarationAi = (targetNations: Nation[], targetRulers: General[], rng: ScriptedRng): GeneralAI => {
    const actorNation = {
        ...baseNation(),
        meta: { ...baseNation().meta, tech: 2_000 },
    };
    const actor = {
        ...baseGeneral(),
        officerLevel: 12,
        npcState: 2,
    };
    const targetCities = targetNations.map((nation, index) => ({
        ...baseCity(),
        id: index + 2,
        name: `대상도시${nation.id}`,
        nationId: nation.id,
    }));
    const cities = [baseCity(), ...targetCities];
    const ai = makeAi({
        general: actor,
        nation: actorNation,
        nations: [actorNation, ...targetNations],
        generals: [actor, ...targetRulers],
        rng,
    });
    const worldRef = ai.worldRef!;
    const mapCityTemplate = ai.map!.cities[0]!;

    Object.assign(ai as unknown as Record<string, unknown>, {
        worldRef: {
            ...worldRef,
            listNations: () => [actorNation, ...targetNations],
            listGenerals: () => [actor, ...targetRulers],
            listCities: () => cities,
            getNationById: (id: number) => [actorNation, ...targetNations].find((nation) => nation.id === id) ?? null,
            getGeneralById: (id: number) => [actor, ...targetRulers].find((general) => general.id === id) ?? null,
            getCityById: (id: number) => cities.find((city) => city.id === id) ?? null,
        },
        map: {
            ...ai.map!,
            cities: [
                { ...mapCityTemplate, id: 1, connections: targetCities.map((city) => city.id) },
                ...targetCities.map((city) => ({
                    ...mapCityTemplate,
                    id: city.id,
                    name: city.name,
                    connections: [1],
                })),
            ],
        },
        frontCities: {},
        npcWarGenerals: { [actor.id]: actor },
        npcCivilGenerals: {},
        userWarGenerals: {},
        userCivilGenerals: {},
        devRate: { pop: 1, all: 1 },
    });

    return ai;
};

const makePromotionAi = (options: {
    ruler: TurnGeneral;
    generals: TurnGeneral[];
    nation?: Partial<Nation>;
    userGenerals?: TurnGeneral[];
    chiefGenerals?: TurnGeneral[];
    npcWarGenerals?: TurnGeneral[];
    npcCivilGenerals?: TurnGeneral[];
    userWarGenerals?: TurnGeneral[];
    userCivilGenerals?: TurnGeneral[];
    rng?: ScriptedRng;
    currentMonth?: number;
}): GeneralAI => {
    const nation = {
        ...baseNation(),
        level: 1,
        ...options.nation,
        meta: { chief_set: 0, ...options.nation?.meta },
    };
    const asGeneralRecord = (entries: TurnGeneral[] = []): Record<number, TurnGeneral> =>
        Object.fromEntries(entries.map((general) => [general.id, general]));
    const asChiefRecord = (entries: TurnGeneral[] = []): Record<number, TurnGeneral> =>
        Object.fromEntries(entries.map((general) => [general.officerLevel, general]));

    return Object.assign(Object.create(GeneralAI.prototype), {
        general: options.ruler,
        nation,
        world: {
            id: 1,
            currentYear: 190,
            currentMonth: options.currentMonth ?? 3,
            tickSeconds: 600,
            lastTurnTime: new Date('0190-03-01T00:00:00Z'),
            meta: { killturn: 100 },
        },
        worldRef: {
            listGenerals: () => options.generals,
        },
        turnTermMinutes: 10,
        aiConst: { chiefStatMin: 70 },
        rng: options.rng ?? makeRng(),
        userGenerals: asGeneralRecord(options.userGenerals),
        chiefGenerals: asChiefRecord(options.chiefGenerals),
        npcWarGenerals: asGeneralRecord(options.npcWarGenerals),
        npcCivilGenerals: asGeneralRecord(options.npcCivilGenerals),
        userWarGenerals: asGeneralRecord(options.userWarGenerals),
        userCivilGenerals: asGeneralRecord(options.userCivilGenerals),
        promotionPatches: [],
        promotionNationMeta: null,
    }) as GeneralAI;
};

const chooseNpcPromotion = (ai: GeneralAI): void =>
    (ai as unknown as { chooseNpcPromotion: () => void }).chooseNpcPromotion();

const chooseNonLordPromotion = (ai: GeneralAI): void =>
    (ai as unknown as { chooseNonLordPromotion: () => void }).chooseNonLordPromotion();

describe('legacy NPC user-chief promotion parity', () => {
    it('appoints the first active user as advisor when the NPC ruler tenure threshold is already met', () => {
        const ruler = makePromotionGeneral({
            id: 1,
            officerLevel: 12,
            npcState: 2,
            meta: { killturn: 100, belong: 2 },
        });
        const user = makePromotionGeneral({
            id: 2,
            name: '신규유저',
            npcState: 0,
            stats: { leadership: 40, strength: 40, intelligence: 40 },
            meta: { killturn: 100, belong: 1 },
        });
        const ai = makePromotionAi({
            ruler,
            generals: [ruler, user],
            userGenerals: [user],
            chiefGenerals: [ruler],
        });

        chooseNpcPromotion(ai);

        expect(ai.consumePromotionPatches()).toEqual({
            generals: [{ generalId: 2, officerLevel: 11, officerCity: 0, permission: 'ambassador' }],
            nationMeta: expect.objectContaining({ chief_set: 1 << 11 }),
        });
    });

    it.each([
        { label: 'inactive user', npcState: 0, killturn: 70, permission: 'auditor' },
        { label: 'NPC', npcState: 3, killturn: 100, permission: undefined },
    ])('demotes the existing $label advisor before forcing an active user into the seat', (oldChiefInput) => {
        const ruler = makePromotionGeneral({
            id: 1,
            officerLevel: 12,
            npcState: 0,
            meta: { killturn: 100, belong: 2, use_auto_nation_promotion: 1 },
        });
        const oldChief = makePromotionGeneral({
            id: 2,
            name: '기존참모',
            officerLevel: 11,
            npcState: oldChiefInput.npcState,
            meta: {
                killturn: oldChiefInput.killturn,
                belong: 2,
                ...(oldChiefInput.permission ? { permission: oldChiefInput.permission } : {}),
            },
        });
        const candidate = makePromotionGeneral({
            id: 3,
            name: '신규참모',
            npcState: 0,
            stats: { leadership: 80, strength: 40, intelligence: 40 },
            meta: { killturn: 100, belong: 1 },
        });
        const ai = makePromotionAi({
            ruler,
            generals: [ruler, oldChief, candidate],
            userGenerals: oldChief.npcState < 2 ? [oldChief, candidate] : [candidate],
            chiefGenerals: [ruler, oldChief],
        });

        chooseNpcPromotion(ai);

        expect(ai.consumePromotionPatches()).toEqual({
            generals: [
                { generalId: oldChief.id, officerLevel: 1, officerCity: 0 },
                { generalId: candidate.id, officerLevel: 11, officerCity: 0, permission: 'ambassador' },
            ],
            nationMeta: expect.objectContaining({ chief_set: 1 << 11 }),
        });
        expect(oldChief).toMatchObject({ officerLevel: 1, meta: expect.objectContaining({ officer_city: 0 }) });
    });

    it('waits for belong 3 before forcing a user over a stronger NPC under an established NPC ruler', () => {
        const run = (belong: number) => {
            const ruler = makePromotionGeneral({
                id: 1,
                officerLevel: 12,
                npcState: 2,
                meta: { killturn: 100, belong: 4 },
            });
            const npc = makePromotionGeneral({
                id: 2,
                name: '강한NPC',
                npcState: 2,
                stats: { leadership: 100, strength: 100, intelligence: 100 },
                meta: { killturn: 100, belong: 4 },
            });
            const user = makePromotionGeneral({
                id: 3,
                name: '유저후보',
                npcState: 0,
                stats: { leadership: 80, strength: 80, intelligence: 80 },
                meta: { killturn: 100, belong },
            });
            const ai = makePromotionAi({
                ruler,
                generals: [ruler, npc, user],
                userGenerals: [user],
                chiefGenerals: [ruler],
            });
            chooseNpcPromotion(ai);
            return ai.consumePromotionPatches().generals;
        };

        expect(run(1)).toEqual([{ generalId: 2, officerLevel: 11, officerCity: 0 }]);
        expect(run(3)).toEqual([{ generalId: 3, officerLevel: 11, officerCity: 0, permission: 'ambassador' }]);
    });

    it('prefers an ambassador-eligible user over a higher-leadership no-ambassador user', () => {
        const ruler = makePromotionGeneral({
            id: 1,
            officerLevel: 12,
            npcState: 2,
            meta: { killturn: 100, belong: 2 },
        });
        const blockedAmbassador = makePromotionGeneral({
            id: 2,
            npcState: 0,
            stats: { leadership: 95, strength: 80, intelligence: 80 },
            meta: { killturn: 100, belong: 1 },
            penalty: { noAmbassador: true },
        });
        const eligible = makePromotionGeneral({
            id: 3,
            npcState: 0,
            stats: { leadership: 70, strength: 80, intelligence: 80 },
            meta: { killturn: 100, belong: 1 },
        });
        const ai = makePromotionAi({
            ruler,
            generals: [ruler, blockedAmbassador, eligible],
            userGenerals: [blockedAmbassador, eligible],
            chiefGenerals: [ruler],
        });

        chooseNpcPromotion(ai);

        expect(ai.consumePromotionPatches().generals).toEqual([
            { generalId: 3, officerLevel: 11, officerCity: 0, permission: 'ambassador' },
        ]);
    });

    it('does not appoint a user carrying the no-chief penalty', () => {
        const ruler = makePromotionGeneral({
            id: 1,
            officerLevel: 12,
            npcState: 2,
            meta: { killturn: 100, belong: 2 },
        });
        const blocked = makePromotionGeneral({
            id: 2,
            npcState: 0,
            stats: { leadership: 100, strength: 100, intelligence: 100 },
            meta: { killturn: 100, belong: 1 },
            penalty: { noChief: true },
        });
        const ai = makePromotionAi({
            ruler,
            generals: [ruler, blocked],
            userGenerals: [blocked],
            chiefGenerals: [ruler],
        });

        chooseNpcPromotion(ai);

        expect(ai.consumePromotionPatches()).toEqual({ generals: [], nationMeta: null });
    });

    it('keeps NPC-assigned diplomatic authority at two even when three user chiefs exist', () => {
        const ruler = makePromotionGeneral({
            id: 1,
            officerLevel: 12,
            npcState: 2,
            meta: { killturn: 100, belong: 4 },
        });
        const existingChiefs = [11, 10, 9].map((officerLevel, index) =>
            makePromotionGeneral({
                id: index + 2,
                npcState: 0,
                officerLevel,
                meta: { killturn: 100, belong: 4, officer_city: 0 },
            })
        );
        const candidate = makePromotionGeneral({
            id: 5,
            npcState: 0,
            stats: { leadership: 100, strength: 100, intelligence: 100 },
            meta: { killturn: 100, belong: 4 },
        });
        const ai = makePromotionAi({
            ruler,
            generals: [ruler, ...existingChiefs, candidate],
            nation: { level: 6 },
            userGenerals: [...existingChiefs, candidate],
            chiefGenerals: [ruler, ...existingChiefs],
        });

        chooseNpcPromotion(ai);

        const promotion = ai.consumePromotionPatches();
        const result = promotion.generals;
        expect(result.filter((entry) => entry.generalId === candidate.id)).toEqual([]);
        expect(result).toHaveLength(2);
        expect(promotion.nationMeta).toBeNull();
        expect(result).toEqual(
            expect.arrayContaining(
                existingChiefs.slice(1).map((chief) => ({
                    generalId: chief.id,
                    officerLevel: chief.officerLevel,
                    officerCity: 0,
                    permission: 'ambassador',
                }))
            )
        );
    });

    it('repairs a third diplomatic authority left by an earlier NPC promotion pass', () => {
        const ruler = makePromotionGeneral({
            id: 1,
            officerLevel: 12,
            npcState: 2,
            meta: { killturn: 100, belong: 4 },
        });
        const existingChiefs = [11, 10, 9].map((officerLevel, index) =>
            makePromotionGeneral({
                id: index + 2,
                npcState: 0,
                officerLevel,
                meta: { killturn: 100, belong: 4, officer_city: 0, permission: 'ambassador' },
            })
        );
        const formerChief = makePromotionGeneral({
            id: 5,
            npcState: 0,
            officerLevel: 1,
            meta: { killturn: 100, belong: 4, officer_city: 0, permission: 'ambassador' },
        });
        const ai = makePromotionAi({
            ruler,
            generals: [ruler, ...existingChiefs, formerChief],
            nation: { level: 6 },
            userGenerals: [...existingChiefs, formerChief],
            chiefGenerals: [ruler, ...existingChiefs],
        });

        chooseNpcPromotion(ai);

        const promotion = ai.consumePromotionPatches();
        expect(promotion.generals).toContainEqual({
            generalId: existingChiefs[0]!.id,
            officerLevel: 11,
            officerCity: 0,
            permission: 'normal',
        });
        expect(promotion.generals).toContainEqual({
            generalId: formerChief.id,
            officerLevel: 1,
            officerCity: 0,
            permission: 'normal',
        });
    });

    it('lets an NPC non-ruler fill an open seat with a user immediately when no NPC pool exists', () => {
        const actor = makePromotionGeneral({
            id: 1,
            officerLevel: 10,
            npcState: 2,
            meta: { killturn: 100, belong: 4 },
        });
        const user = makePromotionGeneral({
            id: 2,
            npcState: 0,
            stats: { leadership: 40, strength: 40, intelligence: 40 },
            meta: { killturn: 100, belong: 1 },
        });
        const ai = makePromotionAi({
            ruler: actor,
            generals: [actor, user],
            userWarGenerals: [user],
            chiefGenerals: [actor],
        });

        chooseNonLordPromotion(ai);

        expect(ai.consumePromotionPatches().generals).toEqual([{ generalId: 2, officerLevel: 11, officerCity: 0 }]);
    });

    it('runs automatic appointments for NPC rulers and only opted-in user rulers in quarter months', () => {
        const run = (currentMonth: number, npcState = 2, enabled = 0) => {
            const ruler = makePromotionGeneral({
                id: 1,
                officerLevel: 12,
                npcState,
                meta: { killturn: 100, belong: 2, use_auto_nation_promotion: enabled },
            });
            const user = makePromotionGeneral({
                id: 2,
                npcState: 0,
                meta: { killturn: 100, belong: 1 },
            });
            const ai = makePromotionAi({
                ruler,
                generals: [ruler, user],
                userGenerals: [user],
                chiefGenerals: [ruler],
                currentMonth,
            });
            Object.assign(ai as unknown as Record<string, unknown>, {
                updateInstance: () => undefined,
                categorizeNationCities: () => undefined,
                categorizeNationGeneral: () => undefined,
                nationPolicy: { priority: [] },
                buildNationCandidate: (action: string, args: Record<string, unknown>, reason: string) => ({
                    action,
                    args,
                    reason,
                }),
            });

            ai.chooseNationTurn({ action: '휴식', args: {} });
            return ai.consumePromotionPatches().generals;
        };

        expect(run(2)).toEqual([]);
        expect(run(3)).toEqual([{ generalId: 2, officerLevel: 11, officerCity: 0, permission: 'ambassador' }]);
        expect(run(3, 0)).toEqual([]);
        expect(run(3, 0, 1)).toEqual([{ generalId: 2, officerLevel: 11, officerCity: 0, permission: 'ambassador' }]);
    });

    it('keeps non-aggression proposals NPC-only while user-ruler duties remain opt-in', () => {
        const ruler = makePromotionGeneral({ id: 1, officerLevel: 12, npcState: 0, meta: { killturn: 0 } });
        expect(canUseAutomatedNationAction(ruler, '선전포고')).toBe(false);
        expect(canUseAutomatedNationAction(ruler, '불가침제의')).toBe(false);
        expect(canUseAutomatedNationAction(ruler, '천도')).toBe(false);
        expect(canUseRulerAutomation(ruler, 'finance')).toBe(false);

        ruler.meta = {
            ...ruler.meta,
            use_auto_nation_diplomacy: 1,
            use_auto_nation_capital: 1,
            use_auto_nation_finance: 1,
        };
        // 기존 DB에 제거된 플래그가 남아 있어도 사용자 군주에게는 다시 활성화되지 않는다.
        expect(canUseAutomatedNationAction(ruler, '불가침제의')).toBe(false);
        expect(canUseAutomatedNationAction(ruler, '선전포고')).toBe(false);
        expect(canUseAutomatedNationAction(ruler, '천도')).toBe(true);
        expect(canUseRulerAutomation(ruler, 'finance')).toBe(true);

        ruler.meta = {
            ...ruler.meta,
            use_auto_nation_war: 1,
        };
        expect(canUseAutomatedNationAction(ruler, '불가침제의')).toBe(false);
        expect(canUseAutomatedNationAction(ruler, '선전포고')).toBe(true);

        const npcRuler = makePromotionGeneral({ id: 2, officerLevel: 12, npcState: 2, meta: { killturn: 0 } });
        expect(canUseAutomatedNationAction(npcRuler, '불가침제의')).toBe(true);
    });

    it('honors the existing automatic nation-turn master switch for user chiefs only', () => {
        const world = {
            currentYear: 190,
            currentMonth: 3,
            meta: {},
        } as TurnWorldState;
        const build = (npcState: number, useAutoNationTurn: number) =>
            makePromotionGeneral({
                npcState,
                meta: { killturn: 0, autorun_limit: 19004, use_auto_nation_turn: useAutoNationTurn },
            });

        expect(shouldUseNationAi(build(0, 0), world)).toBe(false);
        expect(shouldUseNationAi(build(0, 1), world)).toBe(true);
        expect(shouldUseNationAi(build(2, 0), world)).toBe(true);
    });
});

/**
 * Expected branches are extracted from ref/sam hwe/sammo/GeneralAI.php
 * at ng_compare@fe9ae978. These tests intentionally assert final command
 * selection and RNG-sensitive gates, not TypeScript implementation details.
 */
describe('legacy NPC AI final-decision parity', () => {
    it('does not declare war on an adjacent level-0 user wandering nation', () => {
        const wanderingNation = {
            ...baseNation(),
            id: 2,
            name: '유저방랑군',
            capitalCityId: 2,
            chiefGeneralId: 2,
            level: 0,
        };
        const userRuler = {
            ...baseGeneral(),
            id: 2,
            name: '유저방랑군주',
            nationId: 2,
            cityId: 2,
            officerLevel: 12,
            npcState: 0,
        };
        const rng = makeRng([true], [0]);
        const ai = makeDeclarationAi([wanderingNation], [userRuler], rng);

        expect(do선전포고(ai)).toBeNull();
        expect(rng.bools).toEqual([]);
        expect(rng.weightedChoices).toEqual([]);
        expect(rng.choices).toEqual([0]);
    });

    it('uses monthly power to give an active user nation lower declaration weight while excluding its wandering nation', () => {
        const targets = [
            { id: 2, name: '유저방랑군', level: 0, npcState: 0 },
            { id: 3, name: '정식유저국', level: 1, npcState: 0 },
            { id: 4, name: '정식NPC국', level: 1, npcState: 2 },
        ];
        const nations = targets.map(
            ({ id, name, level, npcState }) =>
                ({
                    ...baseNation(),
                    id,
                    name,
                    capitalCityId: id,
                    chiefGeneralId: id,
                    level,
                    // Ref monthly power for otherwise identical fixtures is
                    // 64 with a user general and 62 with an NPC general. The
                    // declaration AI reads that stored result; it does not
                    // inspect the target ruler type directly.
                    power: npcState < 2 ? 64 : 62,
                }) satisfies Nation
        );
        const rulers = targets.map(
            ({ id, name, npcState }) =>
                ({
                    ...baseGeneral(),
                    id,
                    name: `${name}군주`,
                    nationId: id,
                    cityId: id,
                    officerLevel: 12,
                    npcState,
                }) satisfies General
        );

        const userTargetRng = makeRng([true], [0]);
        const userTargetAi = makeDeclarationAi(nations, rulers, userTargetRng);
        expect(do선전포고(userTargetAi)).toMatchObject({
            action: 'che_선전포고',
            args: { destNationId: 3 },
        });
        expect(userTargetRng.weightedChoices).toEqual([
            {
                '3': 1 / Math.sqrt(65),
                '4': 1 / Math.sqrt(63),
            },
        ]);
        expect(userTargetRng.weightedChoices[0]?.['3']).toBeLessThan(userTargetRng.weightedChoices[0]?.['4'] ?? 0);

        const npcTargetRng = makeRng([true], [1]);
        const npcTargetAi = makeDeclarationAi(nations, rulers, npcTargetRng);
        expect(do선전포고(npcTargetAi)).toMatchObject({
            action: 'che_선전포고',
            args: { destNationId: 4 },
        });
        expect(npcTargetRng.weightedChoices).toEqual(userTargetRng.weightedChoices);
    });

    it('rejects the malformed Ref low-rice donation candidate and continues the priority loop', () => {
        const rng = makeRng([false], [0]);
        const ai = makeAi({
            general: { rice: 2_200, gold: 0 },
            nation: { rice: 400, gold: 20_000 },
            genType: 4,
            rng,
        });
        ai.nationPolicy.reqNpcWarRice = 1_000;
        ai.buildGeneralCandidate = ((_action: string, args: Record<string, unknown>) =>
            typeof args.isGold === 'boolean'
                ? { action: 'che_헌납', args, reason: 'NPC헌납' }
                : null) as GeneralAI['buildGeneralCandidate'];

        expect(doNPC헌납(ai)).toBeNull();
        expect(rng.weightedPairs).toEqual([[[{ isGold: 'rice', amount: 1_100 }, 1_100]]]);
    });

    it('blocks another officer from starting a capital move within half a turn', () => {
        const base = makeAi({ general: { officerLevel: 10, turnTick: 36_000_100 } });
        const ai = Object.assign(Object.create(GeneralAI.prototype), base, {
            nation: { ...base.nation!, meta: { ...base.nation!.meta, lastCapitalMoveTrial: [12, 36_000_000] } },
        }) as GeneralAI;

        expect(do천도(ai)).toBeNull();
    });

    it('continues the same capital move and records the legacy trial tick', () => {
        const base = makeAi({ general: { officerLevel: 12, turnTick: 72_000_100 } });
        const ai = Object.assign(Object.create(GeneralAI.prototype), base, {
            nation: {
                ...base.nation!,
                capitalCityId: 1,
                meta: { ...base.nation!.meta, turn_last_12: { command: '천도', arg: { destCityID: 2 } } },
            },
            promotionPatches: [],
            promotionNationMeta: null,
        }) as GeneralAI;

        expect(do천도(ai)).toMatchObject({ action: 'che_천도', args: { destCityID: 2 } });
        expect(ai.consumePromotionPatches().nationMeta).toMatchObject({
            lastCapitalMoveTrial: [12, 72_000_100],
        });
    });

    it('persists the legacy last-attackable month through the nation meta patch channel', () => {
        const ai = Object.assign(Object.create(GeneralAI.prototype), {
            general: { ...baseGeneral(), nationId: 16 },
            nation: { ...baseNation(), id: 16, meta: { last_attackable: 2234 } },
            world: { currentYear: 187, currentMonth: 2, meta: {} },
            worldRef: {
                listDiplomacy: () => [{ fromNationId: 16, toNationId: 2, state: 0, term: 0 }],
                listCities: () => [{ ...baseCity(), nationId: 16, frontState: 3 }],
            },
            startYear: 180,
            promotionPatches: [],
            promotionNationMeta: { last_attackable: 2234, chief_set: 3584 },
        }) as GeneralAI;

        (ai as unknown as { calcDiplomacyState: () => void }).calcDiplomacyState();

        expect(ai.consumePromotionPatches().nationMeta).toMatchObject({ last_attackable: 2245, chief_set: 3584 });
    });

    it('normalizes legacy uppercase destination IDs before AI constraint checks', () => {
        expect(
            withCanonicalArgumentAliases({
                destGeneralID: 2,
                destCityID: 3,
                destNationID: 4,
                destTroopID: 5,
            })
        ).toMatchObject({
            destGeneralId: 2,
            destCityId: 3,
            destNationId: 4,
            destTroopId: 5,
        });
    });

    it('applies the legacy nation-level leadership bonus for officers', () => {
        const ruler = { ...baseGeneral(), officerLevel: 12, injury: 0 };
        const nation = { ...baseNation(), level: 1 };

        expect(resolveLegacyAiStats(ruler, nation, 255)).toMatchObject({
            fullLeadership: 72,
            effectiveLeadership: 72,
        });
        expect(resolveLegacyAiStats({ ...ruler, officerLevel: 5 }, nation, 255)).toMatchObject({
            fullLeadership: 71,
            effectiveLeadership: 71,
        });
        expect(resolveLegacyAiStats({ ...ruler, officerLevel: 1 }, nation, 255)).toMatchObject({
            fullLeadership: 70,
            effectiveLeadership: 70,
        });
    });

    it('applies active action modules to the full stats used by legacy AI recruitment', () => {
        const general = {
            ...baseGeneral(),
            stats: { leadership: 68, strength: 40, intelligence: 60 },
            meta: { killturn: 100 },
        };
        const leadershipTrait = {
            onCalcStat: (context: { general: General }, statName: string, value: number): number =>
                statName === 'leadership' ? value + context.general.stats.leadership * 0.25 : value,
        };
        const modules = singleActionModuleStack(leadershipTrait);
        const world = {
            id: 1,
            currentYear: 189,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0189-01-01T00:00:00Z'),
            meta: {},
        };

        expect(resolveLegacyAiStatsWithModules(general, baseNation(), 100, modules, null, world, 180)).toMatchObject({
            fullLeadership: 85,
            effectiveLeadership: 85,
        });
    });

    it('passes scenario time and maximum tech level to year-scaling stat items', async () => {
        const [leadershipWine] = await loadItemModules(['che_능력치_통솔_보령압주']);
        expect(leadershipWine).toBeDefined();
        const modules = singleActionModuleStack(leadershipWine!);
        const world = {
            id: 1,
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0200-01-01T00:00:00Z'),
            meta: {},
        };

        expect(
            resolveLegacyAiStatsWithModules(baseGeneral(), baseNation(), 100, modules, null, world, 180, 15)
        ).toMatchObject({
            fullLeadership: 80,
            effectiveLeadership: 80,
        });
    });
    it.each([
        ['Core scenario name', '강유'],
        ['Ref stored name', 'ⓝ강유'],
    ])('uses the full ruler name and Ref nation-type/color RNG order: %s', (_label, name) => {
        const rng = makeRng([], ['che_음양가', 19]);
        const ai = makeAi({ general: { name }, rng });
        ai.aiConst.availableNationTypes = ['che_도적', 'che_음양가'];

        expect(do건국(ai)).toMatchObject({
            action: 'che_건국',
            args: { nationName: '㉿강유', nationType: 'che_음양가', colorType: 19 },
        });
    });

    it('counts a wandering-nation ruler on a neutral city as occupying the uprising radius', () => {
        const rng = makeRng([false, true]);
        const currentCity = { ...baseCity(), id: 1, nationId: 0, level: 1 };
        const rulerCity = { ...baseCity(), id: 2, nationId: 0, level: 5 };
        const ruler = { ...baseGeneral(), id: 2, nationId: 9, cityId: 2, officerLevel: 12 };
        const ai = {
            general: { ...baseGeneral(), nationId: 0, cityId: 1, npcState: 2, meta: {} },
            city: currentCity,
            map: {
                id: 'test',
                name: 'test',
                defaults: {},
                cities: [
                    {
                        id: 1,
                        name: '현재',
                        level: 1,
                        region: 1,
                        position: { x: 0, y: 0 },
                        connections: [2],
                        max: {},
                        initial: {},
                    },
                    {
                        id: 2,
                        name: '군주',
                        level: 5,
                        region: 1,
                        position: { x: 1, y: 0 },
                        connections: [1],
                        max: {},
                        initial: {},
                    },
                ],
            },
            worldRef: {
                listCities: () => [currentCity, rulerCity],
                listGenerals: () => [ruler],
                getCityById: (id: number) => (id === 1 ? currentCity : id === 2 ? rulerCity : null),
            },
            generalPolicy: { can: (name: string) => name === '건국' },
            rng,
            aiConst: { defaultStatNpcMax: 100, chiefStatMin: 70 },
            world: { currentYear: 179, meta: { initYear: 179 } },
            startYear: 179,
            buildGeneralCandidate: (action: string, args: Record<string, unknown>, reason: string) => ({
                action,
                args,
                reason,
            }),
        } as unknown as GeneralAI;

        expect(do거병(ai)).toBeNull();
        expect(rng.bools).toEqual([true]);
    });

    it.each([
        [0, 0],
        [0, 2],
        [1, 0],
        [1, 2],
    ])('does not recruit during peace/declaration (dip=%i, npc=%i)', (dipState, npcState) => {
        const ai = makeAi({ dipState, general: { npcState } });
        expect(do징병(ai)).toBeNull();
    });

    it.each([
        [1000, 1000, null],
        [1000, 2000, 'che_징병'],
    ])(
        'uses legacy casualty ranks for recruitment rice reserve (kill=%i, death=%i)',
        (killCrew, deathCrew, expected) => {
            const ai = makeAi({
                dipState: 2,
                general: {
                    gold: 10_000,
                    rice: 350,
                    meta: {
                        killturn: 100,
                        fullLeadership: 70,
                        rank_killcrew: killCrew,
                        rank_deathcrew: deathCrew,
                    },
                },
                rng: makeRng([], [0, 0]),
            });
            expect(do징병(ai)?.action ?? null).toBe(expected);
        }
    );

    it('applies legacy personality cost modifiers before halving recruit crew', () => {
        const ai = makeAi({
            dipState: 2,
            general: {
                gold: 1_000,
                rice: 10_000,
                meta: { killturn: 100, fullLeadership: 70, rank_killcrew: 0, rank_deathcrew: 1 },
            },
            generalActionModules: singleActionModuleStack({
                eventHandlers: {},
                onCalcDomestic: (_context, turnType, varType, value) =>
                    turnType === '징병' && varType === 'cost' ? value * 1.2 : value,
            }),
            rng: makeRng([], [0, 0]),
        });

        expect(do징병(ai)).toMatchObject({
            action: 'che_징병',
            args: { crewType: 1, amount: 3_500 },
        });
    });

    it.each([
        [101, 100, 10_100],
        [140, 100, 14_000],
        [256, 255, 25_600],
        [300, 140, 30_000],
        [300, 255, 30_000],
    ])(
        'requests the command-resolved full crew above the cached AI cap (leadership=%i, cached=%i)',
        (leadership, cachedLeadership, amount) => {
            const ai = makeAi({
                dipState: 2,
                city: { population: 100_000, populationMax: 100_000 },
                general: {
                    stats: { leadership, strength: 70, intelligence: 70 },
                    gold: 100_000,
                    rice: 100_000,
                    meta: { killturn: 100, fullLeadership: cachedLeadership, rank_killcrew: 0, rank_deathcrew: 1 },
                },
                rng: makeRng([], [0, 0]),
            });

            expect(do징병(ai)).toMatchObject({
                action: 'che_징병',
                args: { crewType: 1, amount },
            });
        }
    );

    it('uses recruitment stat modules when resolving uncapped NPC crew capacity', () => {
        const ai = makeAi({
            dipState: 2,
            city: { population: 100_000, populationMax: 100_000 },
            general: {
                stats: { leadership: 240, strength: 70, intelligence: 70 },
                gold: 100_000,
                rice: 100_000,
                meta: { killturn: 100, fullLeadership: 100, rank_killcrew: 0, rank_deathcrew: 1 },
            },
            generalActionModules: singleActionModuleStack({
                eventHandlers: {},
                onCalcStat: (_context, statName, value) => (statName === 'leadership' ? value * 1.25 : value),
            }),
            rng: makeRng([], [0, 0]),
        });

        expect(do징병(ai)).toMatchObject({
            action: 'che_징병',
            args: { crewType: 1, amount: 30_000 },
        });
    });

    it('uses the refillable same-type crew amount for the legacy gold-cost halving threshold', () => {
        const ai = makeAi({
            dipState: 2,
            general: {
                gold: 1_030,
                rice: 970,
                crew: 334,
                crewTypeId: 1,
                meta: {
                    killturn: 100,
                    fullLeadership: 70,
                    rank_killcrew: 1_000,
                    rank_deathcrew: 100,
                },
            },
            generalActionModules: singleActionModuleStack({
                eventHandlers: {},
                onCalcDomestic: (_context, turnType, varType, value) =>
                    turnType === '징병' && varType === 'cost' ? value * 1.2 : value,
            }),
            rng: makeRng([], [0, 0]),
        });

        // Ref prices only the 6,666 refillable soldiers: 800 gold, below the
        // 820-gold reserve. It therefore keeps the full rice requirement and
        // rejects recruitment, instead of halving both crew and rice cost.
        expect(do징병(ai)).toBeNull();
    });

    it.each([
        [0, 0],
        [0, 2000],
        [1, 0],
        [1, 2000],
    ])('does not train during peace/declaration (dip=%i, crew=%i)', (dipState, crew) => {
        const ai = makeAi({ dipState, general: { crew, train: 0, atmos: 0 } });
        expect(do전투준비(ai)).toBeNull();
    });

    it.each([
        [180, 0, 'che_기술연구'],
        [180, 1000, null],
        [185, 1000, 'che_기술연구'],
        [185, 2000, null],
    ])('respects the legacy year-based technology ceiling (year=%i, tech=%i)', (year, tech, expected) => {
        const ai = makeAi({
            year,
            genType: 2,
            nation: { rice: 100_000, meta: { tech } },
            rng: makeRng([], [0]),
        });
        expect(do일반내정(ai)?.action ?? null).toBe(expected);
    });

    it('uses the legacy weighted front-state rule for wartime domestic choices', () => {
        const rng = makeRng([false], [0]);
        const ai = makeAi({
            dipState: 4,
            genType: 2,
            city: {
                frontState: 2,
                agriculture: 1000,
                agricultureMax: 10_000,
                commerce: 10_000,
                commerceMax: 10_000,
            },
            nation: { meta: { tech: 1000 } },
            year: 185,
            rng,
        });
        expect(do전쟁내정(ai)?.action).toBe('che_기술연구');
        const weights = rng.weightedPairs.at(-1)!;
        const agriculture = weights.find(([candidate]) => (candidate as Candidate).action === 'che_농지개간')!;
        expect(agriculture[1]).toBe(420);
    });

    it('coerces fractional nation tech to an integer before the legacy modulo', () => {
        const rng = makeRng([false], [0]);
        const ai = makeAi({
            dipState: 1,
            genType: 6,
            general: {
                stats: { leadership: 73, strength: 44, intelligence: 98 },
                meta: {
                    killturn: 100,
                    effectiveLeadership: 73,
                    effectiveStrength: 69,
                    effectiveIntelligence: 109,
                },
            },
            city: {
                population: 75_098,
                populationMax: 108_500,
            },
            nation: { meta: { tech: 564.87353515625 } },
            year: 185,
            rng,
        });

        do전쟁내정(ai);
        const weights = rng.weightedPairs.at(-1)!;
        const technology = weights.find(([candidate]) => (candidate as Candidate).action === 'che_기술연구')!;
        expect(technology[1]).toBeCloseTo(109 / (565 / 3000), 12);
    });

    it('uses injury-adjusted legacy stats when weighting domestic choices', () => {
        const rng = makeRng([], [2]);
        const ai = makeAi({
            genType: 5,
            general: {
                stats: { leadership: 68, strength: 71, intelligence: 40 },
                meta: {
                    killturn: 100,
                    effectiveLeadership: 68,
                    effectiveStrength: 81,
                    effectiveIntelligence: 58,
                },
            },
            city: {
                population: 100_000,
                populationMax: 293_700,
                defence: 2000,
                defenceMax: 5900,
                wall: 2000,
                wallMax: 6300,
                security: 1000,
                securityMax: 4000,
                meta: { trust: 50, trade: 100 },
            },
            rng,
        });

        expect(do일반내정(ai)?.action).toBe('che_수비강화');
        const weights = rng.weightedPairs.at(-1)!;
        const defence = weights.find(([candidate]) => (candidate as Candidate).action === 'che_수비강화')!;
        expect(defence[1]).toBeCloseTo(238.95);
    });

    it.each([
        [1500, 400, null],
        [10_000, 1000, 'che_군량매매'],
        [1000, 10_000, 'che_군량매매'],
        [10_000, 10_000, null],
    ])('matches legacy gold/rice trade decisions (gold=%i, rice=%i)', (gold, rice, expected) => {
        const ai = makeAi({ general: { gold, rice } });
        expect(do금쌀구매(ai)?.action ?? null).toBe(expected);
    });

    it('uses the global command cap rather than the nation-specific reward cap for trade', () => {
        const ai = makeAi({ general: { gold: 355, rice: 3177 } });
        ai.maxResourceActionAmount = 1200;

        // 명령 parser가 이 원시 수량을 Ref처럼 백 단위 1400으로 반올림한다.
        expect(do금쌀구매(ai)?.args).toEqual({ buyRice: false, amount: 1411 });
    });

    it('uses full leadership and the unit rice price for the trade reserve estimate', () => {
        const ai = makeAi({
            general: {
                gold: 4000,
                rice: 2000,
                stats: { leadership: 10, strength: 70, intelligence: 70 },
                meta: { killturn: 100, fullLeadership: 70 },
            },
        });
        const crewType = ai.unitSet?.crewTypes?.[0];
        if (!crewType) throw new Error('missing test crew type');
        crewType.cost = 9;
        crewType.rice = 20;

        expect(do금쌀구매(ai)?.action).toBe('che_군량매매');
    });

    it('applies domestic action cost modifiers to the trade recruit reserve estimate', () => {
        const ai = makeAi({
            general: { gold: 900, rice: 100 },
            generalActionModules: singleActionModuleStack({
                eventHandlers: {},
                onCalcDomestic: (_context, turnType, varType, value) =>
                    turnType === '징병' && varType === 'cost' ? value * 2 : value,
            }),
        });
        const crewType = ai.unitSet?.crewTypes?.[0];
        if (!crewType) throw new Error('missing test crew type');
        crewType.cost = 9;
        crewType.rice = 9;

        expect(do금쌀구매(ai)).toBeNull();
    });

    it('uses only the additional same-type crew when estimating the recruit gold reserve', () => {
        const ai = makeAi({
            general: { gold: 500, rice: 3000, crew: 6900, crewTypeId: 1 },
            disabledPolicyActions: ['상인무시'],
        });

        // A full 7,000-person estimate would make this branch sell rice. Ref's
        // recruitment calculator prices only the remaining 100 people.
        expect(do금쌀구매(ai)).toBeNull();
    });

    it('randomly chooses between supply and search when national resources are sufficient', () => {
        const ai = makeAi({ rng: makeRng([], [1]) });
        expect(do중립(ai)?.action).toBe('che_인재탐색');
    });

    it('falls back supply -> inspect when the randomly selected neutral command is invalid', () => {
        const ai = makeAi({
            rng: makeRng([], [1]),
            blockedActions: ['che_인재탐색', 'che_물자조달'],
        });
        expect(do중립(ai)?.action).toBe('che_견문');
    });

    it.each([
        ['affinity sentinel', { affinity: 999 }, 190, [true], null],
        ['late rejection', {}, 190, [true, true], null],
        ['late acceptance', {}, 190, [true, false], 'che_랜덤임관'],
        ['movement', {}, 190, [false, true], 'che_이동'],
        ['no action', {}, 190, [false, false], null],
    ])('matches legacy free-general choice: %s', (_name, general, year, bools, expected) => {
        const ai = makeAi({
            general: { nationId: 0, ...general },
            year,
            rng: makeRng(bools, [0]),
        });
        expect(do국가선택(ai)?.action ?? null).toBe(expected);
    });

    it('rejects early random enlistment when no nation exists', () => {
        const ai = makeAi({
            general: { nationId: 0 },
            year: 181,
            nations: [],
            rng: makeRng([true]),
        });
        expect(do국가선택(ai)).toBeNull();
    });

    it('does not count the Core-only neutral nation as a legacy nation', () => {
        const ai = makeAi({
            general: { nationId: 0 },
            year: 181,
            nations: [{ ...baseNation(), id: 0, name: '재야' }],
            rng: makeRng([true]),
        });
        expect(do국가선택(ai)).toBeNull();
    });

    it.each([
        [false, 4, 100, 100, 2000, null],
        [true, 3, 100, 100, 2000, null],
        [true, 4, 89, 100, 2000, null],
        [true, 4, 100, 89, 2000, null],
        [true, 4, 100, 100, 1000, null],
    ])(
        'rejects deployment outside legacy war readiness (attackable=%s dip=%i train=%i atmos=%i crew=%i)',
        (attackable, dipState, train, atmos, crew, expected) => {
            const ai = makeAi({
                attackable,
                dipState,
                general: { train, atmos, crew },
                city: { frontState: 3 },
            });
            expect(do출병(ai)?.action ?? null).toBe(expected);
        }
    );

    it('updates NPC troop-leader lifespan before selecting assembly', () => {
        const ai = makeAi({
            general: { npcState: 5, meta: { killturn: 69 } },
            rng: makeRng([], [3]),
        });
        expect(do집합(ai)?.action).toBe('che_집합');
        expect(ai.general.meta.killturn).toBe(72);
        expect(ai.general.meta.killturn).toBeGreaterThanOrEqual(70);
    });

    it('does not warp to the rear when recruitment is disabled', () => {
        const ai = makeAi({
            dipState: 4,
            general: { crew: 0 },
            city: { population: 10_000 },
            disabledPolicyActions: ['징병'],
        });
        expect(do후방워프(ai)).toBeNull();
    });

    it('uses full leadership for the legacy rear-warp recruitment floor', () => {
        const ai = makeAi({
            dipState: 4,
            general: {
                crew: 0,
                stats: { leadership: 10, strength: 70, intelligence: 70 },
                meta: { killturn: 100, fullLeadership: 100 },
            },
            city: { population: 10_000 },
        });
        ai.categorizeNationCities = () => {
            const candidate = {
                ...baseCity(),
                id: 2,
                population: 35_000,
                populationMax: 50_000,
                dev: 0.7,
                important: 0,
            };
            ai.backupCities = { 2: candidate };
            ai.supplyCities = { 2: candidate };
        };

        expect(do후방워프(ai)).toBeNull();
    });

    it('categorizes generals before weighting a front-line warp destination', () => {
        const ai = makeAi({
            dipState: 4,
            attackable: true,
            general: { crew: 2000 },
        });
        let categorizedGenerals = false;
        ai.categorizeNationCities = () => {
            ai.frontCities = { 1: { ...baseCity(), frontState: 3, important: 1, dev: 1 } };
        };
        ai.categorizeNationGeneral = () => {
            categorizedGenerals = true;
            ai.frontCities[1]!.important = 2;
        };
        expect(do전방워프(ai)?.action).toBe('che_NPC능동');
        expect(categorizedGenerals).toBe(true);
    });

    it('keeps the legacy empty city-general counts when weighting a domestic warp', () => {
        const ai = makeAi({ rng: makeRng([false, true]) });
        ai.categorizeNationCities = () => {
            ai.supplyCities = {
                1: { ...baseCity(), dev: 1, important: 0, generals: {} },
                2: {
                    ...baseCity(),
                    id: 2,
                    agriculture: 1000,
                    commerce: 1000,
                    security: 1000,
                    defence: 1000,
                    wall: 1000,
                    dev: 0.1,
                    important: 0,
                    generals: {},
                },
            };
        };
        ai.categorizeNationGeneral = () => {
            throw new Error('Ref does not categorize generals in do내정워프');
        };

        expect(do내정워프(ai)?.action).toBe('che_NPC능동');
    });

    it('moves a mounted user rear only for an earlier first recruitment turn', () => {
        const run = (options: {
            reservedAction: string;
            userTurnTick: number;
            leaderTurnTick: number;
            recruitmentScore?: number;
        }) => {
            const rng = makeRng([], [0, 0]);
            const user = {
                ...baseGeneral(),
                id: 2,
                cityId: 2,
                troopId: 10,
                npcState: 0,
                turnTick: options.userTurnTick,
            };
            const leader = {
                ...baseGeneral(),
                id: 10,
                cityId: 2,
                troopId: 10,
                npcState: 5,
                turnTick: options.leaderTurnTick,
            };
            const ai = makeAi({
                dipState: 4,
                rng,
                generals: [baseGeneral(), user, leader],
                reservedTurns: { 2: { action: options.reservedAction } },
                generalActionModules:
                    options.recruitmentScore === undefined
                        ? undefined
                        : singleActionModuleStack({
                              eventHandlers: {},
                              onCalcDomestic: (_context, turnType, varType, value) =>
                                  turnType === '징집인구' && varType === 'score' ? options.recruitmentScore! : value,
                          }),
            });
            ai.userWarGenerals = { 2: user };
            ai.troopLeaders = { 10: leader };
            ai.nationCities = {
                2: {
                    ...baseCity(),
                    id: 2,
                    population: 10_000,
                    frontState: 3,
                    dev: 1,
                    important: 1,
                },
            };
            ai.frontCities = { 2: ai.nationCities[2]! };
            ai.supplyCities = {
                2: ai.nationCities[2]!,
                3: { ...baseCity(), id: 3, dev: 1, important: 1 },
            };
            ai.backupCities = { 3: ai.supplyCities[3]! };
            return { result: do부대유저장후방발령(ai), rng };
        };

        for (const reservedAction of ['che_징병', 'che_모병']) {
            expect(run({ reservedAction, userTurnTick: 100, leaderTurnTick: 200 }).result).toMatchObject({
                action: 'che_발령',
                args: { destGeneralId: 2, destCityId: 3 },
            });
        }
        expect(run({ reservedAction: 'che_훈련', userTurnTick: 100, leaderTurnTick: 200 }).result).toBeNull();
        expect(run({ reservedAction: 'che_징병', userTurnTick: 200, leaderTurnTick: 100 }).result).toBeNull();
        expect(
            run({ reservedAction: 'che_징병', userTurnTick: 100, leaderTurnTick: 200, recruitmentScore: 0 }).result
        ).toBeNull();
    });

    it('uses full leadership and the chief city exclusion for a user rear assignment', () => {
        const user = { ...baseGeneral(), id: 2, cityId: 2, npcState: 0 };
        const build = (withLeadershipBonus: boolean) => {
            const ai = makeAi({
                dipState: 4,
                generals: [baseGeneral(), user],
                generalActionModules: withLeadershipBonus
                    ? singleActionModuleStack({
                          eventHandlers: {},
                          onCalcStat: (_context, statName, value) =>
                              statName === 'leadership' ? Number(value) + 30 : value,
                      })
                    : undefined,
            });
            ai.userWarGenerals = { 2: user };
            ai.supplyCities = {
                1: { ...baseCity(), id: 1, dev: 1, important: 1 },
                2: { ...baseCity(), id: 2, population: 10_000, dev: 1, important: 1 },
                3: { ...baseCity(), id: 3, population: 37_000, dev: 1, important: 1 },
            };
            ai.backupCities = {
                1: ai.supplyCities[1]!,
                3: ai.supplyCities[3]!,
            };
            return do유저장후방발령(ai);
        };

        expect(build(false)).toMatchObject({
            action: 'che_발령',
            args: { destGeneralId: 2, destCityId: 3 },
        });
        expect(build(true)).toBeNull();
    });

    it('waits through recruitment and preparation before sending a user to the front', () => {
        const run = (crew: number, train: number, atmos: number) => {
            const user = { ...baseGeneral(), id: 2, cityId: 2, npcState: 0, crew, train, atmos };
            const ai = makeAi({ dipState: 4, generals: [baseGeneral(), user] });
            ai.userWarGenerals = { 2: user };
            ai.nationCities = {
                2: { ...baseCity(), id: 2, population: 10_000, dev: 1, important: 1 },
            };
            ai.supplyCities = {
                2: ai.nationCities[2]!,
                3: { ...baseCity(), id: 3, dev: 1, important: 1 },
            };
            ai.backupCities = { 3: ai.supplyCities[3]! };
            ai.frontCities = {
                20: { ...baseCity(), id: 20, frontState: 3, dev: 1, important: 1 },
            };
            return {
                rear: do유저장후방발령(ai),
                front: do유저장전방발령(ai),
            };
        };

        expect(run(0, 0, 0).rear).toMatchObject({ args: { destGeneralId: 2, destCityId: 3 } });
        expect(run(1_500, 0, 0)).toEqual({ rear: null, front: null });
        expect(run(1_500, 90, 0).front).toMatchObject({
            action: 'che_발령',
            args: { destGeneralId: 2, destCityId: 20 },
        });
    });

    it('keeps mounted users out of front assignment and draws the prepared user first', () => {
        const mounted = {
            ...baseGeneral(),
            id: 2,
            cityId: 2,
            npcState: 0,
            troopId: 10,
            crew: 2_000,
            train: 100,
            atmos: 100,
        };
        const first = { ...mounted, troopId: 0 };
        const second = { ...mounted, id: 3, troopId: 0 };
        const rng = makeRng([], [1, 20]);
        const ai = makeAi({ dipState: 4, rng, generals: [baseGeneral(), first, second] });
        ai.userWarGenerals = { 2: first, 3: second };
        ai.nationCities = { 2: { ...baseCity(), id: 2, dev: 1, important: 1 } };
        ai.frontCities = { 20: { ...baseCity(), id: 20, frontState: 3, dev: 1, important: 1 } };

        expect(do유저장전방발령(ai)).toMatchObject({
            action: 'che_발령',
            args: { destGeneralId: 3, destCityId: 20 },
        });

        ai.userWarGenerals = { 2: mounted };
        expect(do유저장전방발령(ai)).toBeNull();
    });

    it('preserves intentional defenders and earlier troop escapes during user rescue assignment', () => {
        const ready = {
            ...baseGeneral(),
            id: 2,
            npcState: 0,
            crew: 2_000,
            train: 80,
            atmos: 80,
            meta: { ...baseGeneral().meta, defence_train: 80 },
        };
        const rider = { ...baseGeneral(), id: 3, npcState: 0, troopId: 10, turnTick: 200 };
        const leader = { ...baseGeneral(), id: 10, npcState: 5, cityId: 5, troopId: 10, turnTick: 100 };
        const first = { ...baseGeneral(), id: 4, npcState: 0 };
        const second = { ...baseGeneral(), id: 5, npcState: 0 };
        const rng = makeRng([], [1, 2, 1]);
        const ai = makeAi({ dipState: 4, rng, generals: [baseGeneral(), ready, rider, leader, first, second] });
        ai.lostGenerals = { 2: ready, 3: rider, 4: first, 5: second };
        ai.troopLeaders = { 10: leader };
        ai.supplyCities = { 5: { ...baseCity(), id: 5, dev: 1, important: 1 } };
        ai.frontCities = {
            20: { ...baseCity(), id: 20, frontState: 3, dev: 1, important: 1 },
            21: { ...baseCity(), id: 21, frontState: 3, dev: 1, important: 1 },
            22: { ...baseCity(), id: 22, frontState: 3, dev: 1, important: 1 },
        };

        expect(do유저장구출발령(ai)).toMatchObject({
            action: 'che_발령',
            args: { destGeneralId: 5, destCityId: 22 },
        });
        expect(rng.choices).toEqual([]);
    });

    it('awards a resource-poor civil user general like the legacy nation AI', () => {
        const ai = makeAi();
        const civilGeneral = {
            ...baseGeneral(),
            id: 2,
            npcState: 0,
            gold: 0,
            rice: 20_000,
            meta: { killturn: 100, fullLeadership: 70 },
            turnTime: new Date('0190-01-01T00:00:00Z'),
        };
        ai.userGenerals = { 2: civilGeneral };
        ai.userWarGenerals = {};
        expect(do유저장포상(ai)?.action).toBe('che_포상');
    });

    it('never includes user generals in the legacy NPC seizure pool', () => {
        const ai = makeAi({ nation: { gold: 1_000, rice: 1_000 } });
        const richUser = {
            ...baseGeneral(),
            id: 2,
            npcState: 0,
            gold: 100_000,
            rice: 100_000,
        };
        ai.userGenerals = { 2: richUser };
        ai.userWarGenerals = { 2: richUser };
        ai.npcWarGenerals = {};
        ai.npcCivilGenerals = {};

        expect(doNPC몰수(ai)).toBeNull();
    });

    it('consumes the legacy reward draw before a selected command fails constraints', () => {
        const rng = makeRng();
        const ai = makeAi({ rng, blockedActions: ['che_포상'] });
        const civilGeneral = {
            ...baseGeneral(),
            id: 2,
            npcState: 0,
            gold: 0,
            rice: 20_000,
            meta: { killturn: 100, fullLeadership: 70 },
            turnTime: new Date('0190-01-01T00:00:00Z'),
        };
        ai.userGenerals = { 2: civilGeneral };
        ai.userWarGenerals = {};

        expect(do유저장포상(ai)).toBeNull();
        expect(rng.weightedPairs).toHaveLength(1);
    });

    it('keeps Ref multiplication order at an exact NPC reward resource boundary', () => {
        const rng = makeRng();
        const ai = makeAi({
            year: 185,
            startYear: 180,
            nation: { rice: 12_088, meta: { tech: 1_011.416320800781 } },
            rng,
        });
        ai.nationPolicy.reqNationRice = 10_000;
        ai.nationPolicy.reqNpcWarRice = 4_000;
        ai.maxResourceActionAmount = 2_400;
        const candidate = (id: number, leadership: number, rice: number) => ({
            ...baseGeneral(),
            id,
            stats: { ...baseGeneral().stats, leadership },
            rice,
            crewTypeId: 1,
            meta: { killturn: 100, fullLeadership: leadership },
        });
        ai.npcWarGenerals = {
            180: candidate(180, 88, 3_005),
            743: candidate(743, 80, 3_036),
        };
        ai.npcCivilGenerals = {};

        expect(doNPC포상(ai)).toMatchObject({
            action: 'che_포상',
            args: { destGeneralId: 180, isGold: false },
        });
        expect(rng.weightedPairs[0]?.[0]?.[0]).toMatchObject({ destGeneralId: 180 });
        expect(rng.weightedPairs[0]).toHaveLength(1);
    });

    it('uses target action modules for the full leadership in NPC reward costs', () => {
        const ai = makeAi({
            nation: { rice: 100_000 },
            generalActionModules: singleActionModuleStack({
                eventHandlers: {},
                onCalcStat: (_context, statName, value) => (statName === 'leadership' ? Number(value) + 30 : value),
            }),
        });
        ai.maxResourceActionAmount = 100_000;
        const crewType = ai.unitSet?.crewTypes?.[0];
        if (!crewType) throw new Error('missing test crew type');
        crewType.cost = 100;
        ai.npcWarGenerals = {
            2: {
                ...baseGeneral(),
                id: 2,
                rice: 0,
                crewTypeId: crewType.id,
                meta: { killturn: 100 },
            },
        };
        ai.npcCivilGenerals = {};

        expect(doNPC포상(ai)).toMatchObject({
            action: 'che_포상',
            args: { destGeneralId: 2, isGold: false, amount: 88_000 },
        });
    });

    it('uses target action modules when classifying NPC war generals', () => {
        const specialist = {
            ...baseGeneral(),
            id: 2,
            stats: { ...baseGeneral().stats, leadership: 32 },
            meta: { killturn: 100 },
        };
        const base = makeAi({
            generals: [baseGeneral(), specialist],
            generalActionModules: singleActionModuleStack({
                eventHandlers: {},
                onCalcStat: (context, statName, value) =>
                    context.general.id === 2 && statName === 'leadership' ? Number(value) + 10 : value,
            }),
        });
        const ai = Object.assign(Object.create(GeneralAI.prototype), base, {
            categorizedCities: false,
            categorizedGenerals: false,
            nationCities: {},
            frontCities: {},
            supplyCities: {},
            backupCities: {},
        }) as GeneralAI;
        ai.nationPolicy.minNpcWarLeadership = 40;

        ai.categorizeNationGeneral();

        expect(ai.npcWarGenerals[2]?.id).toBe(2);
        expect(ai.npcCivilGenerals[2]).toBeUndefined();
    });

    it('excludes no-population recruitment specialists before NPC rear assignment draws RNG', () => {
        const rng = makeRng([], [0, 0]);
        const specialist = {
            ...baseGeneral(),
            id: 2,
            cityId: 2,
            crew: 0,
            role: { ...baseGeneral().role, specialWar: 'che_징병' },
            turnTime: new Date('0190-01-01T00:00:00Z'),
        };
        const ai = makeAi({
            dipState: 4,
            rng,
            generals: [baseGeneral(), specialist],
            generalActionModules: singleActionModuleStack({
                eventHandlers: {},
                onCalcDomestic: (context, turnType, varType, value) =>
                    context.general.id === 2 && turnType === '징집인구' && varType === 'score' ? 0 : value,
            }),
        });
        ai.frontCities = { 1: { ...baseCity(), frontState: 3, dev: 1, important: 1 } };
        ai.supplyCities = {
            2: {
                ...baseCity(),
                id: 2,
                population: 40_000,
                populationMax: 100_000,
                dev: 1,
                important: 1,
            },
            3: { ...baseCity(), id: 3, population: 100_000, dev: 1, important: 1 },
        };
        ai.backupCities = { 3: ai.supplyCities[3]! };
        ai.npcWarGenerals = { 2: specialist };

        expect(doNPC후방발령(ai)).toBeNull();
        expect(rng.choices).toEqual([0, 0]);
    });

    it('draws a rescue city for every lost NPC before choosing the completed pair', () => {
        const rng = makeRng([], [0, 1, 1]);
        const first = { ...baseGeneral(), id: 2 };
        const second = { ...baseGeneral(), id: 3 };
        const ai = makeAi({ rng });
        ai.lostGenerals = { 2: first, 3: second };
        ai.supplyCities = {
            40: { ...baseCity(), id: 40, dev: 1, important: 1 },
            64: { ...baseCity(), id: 64, dev: 1, important: 1 },
        };

        expect(doNPC구출발령(ai)).toMatchObject({
            action: 'che_발령',
            args: { destGeneralId: 3, destCityId: 64 },
        });
        expect(rng.choices).toEqual([]);
    });

    it('draws the NPC front-assignment general before the weighted destination city', () => {
        const rng = makeRng([], [1, 20]);
        const first = { ...baseGeneral(), id: 2, crew: 3000, train: 100, atmos: 100 };
        const second = { ...baseGeneral(), id: 3, crew: 3000, train: 100, atmos: 100 };
        const ai = makeAi({ dipState: 4, rng });
        ai.npcWarGenerals = { 2: first, 3: second };
        ai.nationCities = { 1: { ...baseCity(), dev: 1, important: 1 } };
        ai.frontCities = {
            20: { ...baseCity(), id: 20, frontState: 2, dev: 1, important: 1 },
        };

        expect(doNPC전방발령(ai)).toMatchObject({
            action: 'che_발령',
            args: { destGeneralId: 3, destCityId: 20 },
        });
    });

    it('draws a rear-assignment troop leader before its destination city', () => {
        const rng = makeRng([], [1, 0]);
        const first = { ...baseGeneral(), id: 979, cityId: 2 };
        const second = { ...baseGeneral(), id: 980, cityId: 2 };
        const ai = makeAi({ rng });
        ai.troopLeaders = { 979: first, 980: second };
        ai.nationPolicy.supportForce = [979, 980];
        ai.frontCities = { 1: { ...baseCity(), frontState: 3, dev: 1, important: 1 } };
        ai.supplyCities = {
            2: { ...baseCity(), id: 2, population: 10_000, dev: 1, important: 1 },
            3: { ...baseCity(), id: 3, dev: 1, important: 1 },
        };
        ai.backupCities = { 3: ai.supplyCities[3]! };

        expect(do부대후방발령(ai)).toMatchObject({
            action: 'che_발령',
            args: { destGeneralId: 980, destCityId: 3 },
        });
        expect(rng.choices).toEqual([]);
    });

    it('draws a rescue-assignment troop leader before its destination city', () => {
        const rng = makeRng([], [1, 0]);
        const first = { ...baseGeneral(), id: 979, cityId: 99 };
        const second = { ...baseGeneral(), id: 980, cityId: 99 };
        const ai = makeAi({ rng });
        ai.troopLeaders = { 979: first, 980: second };
        ai.nationPolicy.supportForce = [];
        ai.nationPolicy.combatForce = {};
        ai.frontCities = {
            20: { ...baseCity(), id: 20, frontState: 3, dev: 1, important: 1 },
            21: { ...baseCity(), id: 21, frontState: 3, dev: 1, important: 1 },
        };
        ai.supplyCities = {};

        expect(do부대구출발령(ai)).toMatchObject({
            action: 'che_발령',
            args: { destGeneralId: 980, destCityId: 20 },
        });
        expect(rng.choices).toEqual([]);
    });

    it('seizes a small war-NPC surplus while the treasury is below 1.5x reserve', () => {
        const ai = makeAi({ nation: { gold: 12_000, rice: 100_000 } });
        const warGeneral = {
            ...baseGeneral(),
            id: 2,
            gold: 25_000,
            rice: 10_000,
            meta: { killturn: 100, fullLeadership: 70 },
            turnTime: new Date('0190-01-01T00:00:00Z'),
        };
        ai.npcCivilGenerals = {};
        ai.npcWarGenerals = { 2: warGeneral };
        expect(doNPC몰수(ai)?.action).toBe('che_몰수');
    });

    it('carries the Ref gold sort order into equal-rice NPC seizure candidates', () => {
        const rng = makeRng();
        const ai = makeAi({ nation: { gold: 1_000, rice: 1_000 }, rng });
        ai.nationPolicy.reqNationGold = 10_000;
        ai.nationPolicy.reqNationRice = 10_000;
        ai.nationPolicy.reqNpcWarGold = 1_000;
        ai.nationPolicy.reqNpcWarRice = 1_000;
        const candidate = (id: number, gold: number) => ({
            ...baseGeneral(),
            id,
            gold,
            rice: 5_000,
            meta: { killturn: 100, fullLeadership: 70 },
        });
        ai.npcCivilGenerals = {};
        ai.npcWarGenerals = {
            77: candidate(77, 4_000),
            534: candidate(534, 5_000),
        };

        expect(doNPC몰수(ai)?.action).toBe('che_몰수');
        const riceCandidates = (rng.weightedPairs[0] ?? [])
            .map(([args]) => args as { isGold: boolean; destGeneralId: number })
            .filter((args) => !args.isGold)
            .map((args) => args.destGeneralId);
        expect(riceCandidates).toEqual([534, 77]);
    });
});
