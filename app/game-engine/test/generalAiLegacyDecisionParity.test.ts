import { describe, expect, it } from 'vitest';
import type { City, General, Nation } from '@sammo-ts/logic';

import type { GeneralAI } from '../src/turn/ai/generalAi.js';
import { do일반내정, do전쟁내정 } from '../src/turn/ai/generalAi/general/devActions.js';
import { do금쌀구매 } from '../src/turn/ai/generalAi/general/economyActions.js';
import { do국가선택, do중립 } from '../src/turn/ai/generalAi/general/politicsActions.js';
import { do징병 } from '../src/turn/ai/generalAi/general/recruitActions.js';
import { do전투준비, do출병 } from '../src/turn/ai/generalAi/general/warActions.js';
import { do전방워프, do집합, do후방워프 } from '../src/turn/ai/generalAi/general/warpActions.js';
import { doNPC몰수, do유저장포상 } from '../src/turn/ai/generalAi/nation/rewards.js';

type Candidate = {
    action: string;
    args: Record<string, unknown>;
    reason: string;
};

type ScriptedRng = {
    bools: boolean[];
    choices: unknown[];
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

const baseGeneral = (): General => ({
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
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 100, fullLeadership: 70 },
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

    return {
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
    } as unknown as GeneralAI;
};

/**
 * Expected branches are extracted from ref/sam hwe/sammo/GeneralAI.php
 * at ng_compare@fe9ae978. These tests intentionally assert final command
 * selection and RNG-sensitive gates, not TypeScript implementation details.
 */
describe('legacy NPC AI final-decision parity', () => {
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

    it.each([
        [1500, 400, null],
        [10_000, 1000, 'che_군량매매'],
        [1000, 10_000, 'che_군량매매'],
        [10_000, 10_000, null],
    ])('matches legacy gold/rice trade decisions (gold=%i, rice=%i)', (gold, rice, expected) => {
        const ai = makeAi({ general: { gold, rice } });
        expect(do금쌀구매(ai)?.action ?? null).toBe(expected);
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
});
