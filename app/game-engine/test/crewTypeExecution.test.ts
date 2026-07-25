import { WarActionPipeline, type General, type ScenarioConfig, type UnitSetDefinition } from '@sammo-ts/logic';
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
