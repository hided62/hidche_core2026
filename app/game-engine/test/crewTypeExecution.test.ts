import {
    ActionLogger,
    GeneralActionPipeline,
    WarActionPipeline,
    WarCrewType,
    WarUnitCity,
    WarUnitGeneral,
    type General,
    type Nation,
    type ScenarioConfig,
    type UnitSetDefinition,
} from '@sammo-ts/logic';
import { ConstantRNG, RandUtil } from '@sammo-ts/common';
import { describe, expect, it } from 'vitest';

import { buildCommandEnv, buildReservedTurnDefinitions } from '../src/turn/reservedTurnCommands.js';
import { buildRecruitArmTypeWeights } from '../src/turn/ai/generalAi/general/recruitActions.js';

const scenarioConfig: ScenarioConfig = {
    stat: {
        total: 200,
        min: 10,
        max: 100,
        npcTotal: 200,
        npcMin: 10,
        npcMax: 100,
        chiefMin: 10,
    },
    iconPath: '',
    map: {},
    const: {},
    environment: { mapName: 'test', unitSet: 'test' },
};

const general: General = {
    id: 1,
    name: '공성장',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 80, strength: 80, intelligence: 80 },
    experience: 0,
    dedication: 0,
    officerLevel: 3,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1000,
    rice: 1000,
    crew: 1000,
    crewTypeId: 1500,
    train: 100,
    atmos: 100,
    age: 20,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
};

const unitSet: UnitSetDefinition = {
    id: 'engine-crew',
    name: 'engine-crew',
    defaultCrewTypeId: 1100,
    crewTypes: [
        {
            id: 1100,
            armType: 1,
            name: '보병',
            attack: 100,
            defence: 100,
            speed: 7,
            avoid: 10,
            magicCoef: 0,
            cost: 9,
            rice: 9,
            requirements: [],
            attackCoef: {},
            defenceCoef: {},
            info: [],
            initSkillTrigger: null,
            phaseSkillTrigger: null,
            iActionList: null,
        },
        {
            id: 1500,
            armType: 5,
            name: '정란',
            attack: 100,
            defence: 100,
            speed: 7,
            avoid: 10,
            magicCoef: 0,
            cost: 9,
            rice: 9,
            requirements: [],
            attackCoef: {},
            defenceCoef: {},
            info: [],
            initSkillTrigger: null,
            phaseSkillTrigger: null,
            iActionList: ['che_성벽선제'],
        },
    ],
};

describe('reserved turn crew type wiring', () => {
    it('installs the crew action router before inherit and item handlers', async () => {
        const env = buildCommandEnv(scenarioConfig, unitSet);

        await buildReservedTurnDefinitions({
            env,
            commandProfile: { general: ['휴식'], nation: ['휴식'] },
            defaultActionKey: '휴식',
        });

        expect(env.unitSet).toBe(unitSet);
        expect(env.warActionModules?.length).toBeGreaterThan(2);

        const pipeline = new WarActionPipeline(env.warActionModules ?? []);
        expect(pipeline.onCalcOpposeStat({ general }, 'cityBattleOrder', -1)).toBe(10000);
    });

    it('installs nation, officer, domestic, war, and personality effects in live commands', async () => {
        const env = buildCommandEnv(scenarioConfig, unitSet);
        await buildReservedTurnDefinitions({
            env,
            commandProfile: { general: ['휴식'], nation: ['휴식'] },
            defaultActionKey: '휴식',
        });
        const nation: Nation = {
            id: 1,
            name: '효과국',
            color: '#000000',
            capitalCityId: 1,
            chiefGeneralId: 1,
            gold: 0,
            rice: 0,
            power: 0,
            level: 5,
            typeCode: 'che_유가',
            meta: {},
        };
        const traitGeneral: General = {
            ...general,
            officerLevel: 12,
            role: {
                ...general.role,
                personality: 'che_패권',
                specialDomestic: 'che_상재',
                specialWar: 'che_기병',
            },
        };
        const pipeline = new GeneralActionPipeline(env.generalActionModules ?? []);
        const context = { general: traitGeneral, nation };

        expect(pipeline.onCalcDomestic(context, '상업', 'score', 100)).toBeCloseTo(127.05);
        expect(pipeline.onCalcDomestic(context, '상업', 'cost', 100)).toBeCloseTo(64);
        expect(pipeline.onCalcDomestic(context, '징병', 'cost', 100, { armType: 3 })).toBeCloseTo(108);
        expect(pipeline.onCalcStat(context, 'leadership', 80)).toBe(90);

        const rng = new RandUtil(new ConstantRNG(0));
        const warConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, cavalry: 3, castle: 0 },
        };
        const warPipeline = new WarActionPipeline(env.warActionModules ?? []);
        const battleCity = {
            id: 1,
            name: '출병지',
            nationId: 1,
            level: 5,
            state: 0,
            population: 10000,
            populationMax: 10000,
            agriculture: 0,
            agricultureMax: 0,
            commerce: 0,
            commerceMax: 0,
            security: 0,
            securityMax: 0,
            supplyState: 1,
            frontState: 0,
            defence: 100,
            defenceMax: 100,
            wall: 100,
            wallMax: 100,
            meta: {},
        };
        const attacker = new WarUnitGeneral(
            rng,
            warConfig,
            traitGeneral,
            battleCity,
            nation,
            true,
            new WarCrewType(unitSet.crewTypes![0]!),
            new ActionLogger({ generalId: 1, nationId: 1 }),
            warPipeline
        );
        const defender = new WarUnitCity(
            rng,
            warConfig,
            battleCity,
            nation,
            new WarCrewType({
                ...unitSet.crewTypes![0]!,
                id: 1000,
                armType: 0,
                name: '성벽',
            }),
            new ActionLogger({}),
            100,
            100
        );
        expect(
            warPipeline.getWarPowerMultiplier(attacker.getActionContext(), attacker, defender)
        ).toEqual([1.284, 0.93]);
        expect(warPipeline.onCalcStat(attacker.getActionContext(), 'bonusTrain', 100)).toBe(105);
    });
});

describe('NPC crew type selection', () => {
    it('matches the legacy stat and dexterity weights for arm-type selection', () => {
        const weightedGeneral: General = {
            ...general,
            stats: { ...general.stats, strength: 80, intelligence: 75 },
            meta: {
                killturn: 24,
                fullStrength: 80,
                fullIntelligence: 75,
                dex1: 400,
                dex2: 1300,
                dex3: 3100,
                dex4: 7600,
            },
        };

        expect(
            buildRecruitArmTypeWeights(weightedGeneral, {
                footman: 1,
                archer: 2,
                cavalry: 3,
                wizard: 4,
            })
        ).toEqual([
            [1, Math.sqrt(900) * 80],
            [2, Math.sqrt(1800) * 80],
            [3, Math.sqrt(3600) * 80],
            [4, Math.sqrt(8100) * 75 * 3],
        ]);
    });
});
