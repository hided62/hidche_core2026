import { ConstantRNG, RandUtil } from '@sammo-ts/common';
import { describe, expect, it } from 'vitest';

import type { General, Nation } from '../../../src/domain/entities.js';
import { parseScenarioGeneralPoolCandidate } from '../../../src/actions/turn/generalPool.js';
import {
    ActionResolver,
    type VolunteerRecruitEnvironment,
    type VolunteerRecruitResolveContext,
} from '../../../src/actions/turn/nation/che_의병모집.js';

const general: General = {
    id: 1,
    name: '군주',
    nationId: 1,
    cityId: 3,
    troopId: 0,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    experience: 1_000,
    dedication: 1_000,
    officerLevel: 12,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
};

const nation: Nation = {
    id: 1,
    name: '테스트국',
    color: '#000000',
    capitalCityId: 3,
    chiefGeneralId: 1,
    gold: 10_000,
    rice: 10_000,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: { gennum: 1, strategic_cmd_limit: 0 },
};

const environment: VolunteerRecruitEnvironment = {
    openingPartYear: 0,
    initialNationGenLimit: 10,
    defaultNpcGold: 1_000,
    defaultNpcRice: 1_000,
    defaultCrewTypeId: 0,
    defaultSpecialDomestic: null,
    defaultSpecialWar: null,
    createCountBase: 1,
    createCountDivisor: 8,
    npcAge: 20,
    npcDeathYears: 10,
    randomGeneralFirstNames: ['장'],
    randomGeneralMiddleNames: [''],
    randomGeneralLastNames: ['수'],
    availablePersonalities: ['che_안전'],
};

describe('nation volunteer recruitment lifespan', () => {
    it('places the Ref birth and death years on the created general entity', () => {
        const resolver = new ActionResolver([], environment);
        const context = {
            general: structuredClone(general),
            nation: structuredClone(nation),
            rng: new RandUtil(new ConstantRNG(0)),
            addLog: () => undefined,
            currentYear: 190,
            currentMonth: 1,
            startYear: 180,
            centennialRules: {
                defaultStatMin: 15,
                defaultStatMax: 80,
                defaultStatTotal: 165,
                maxStatLevel: 255,
                defaultSpecialDomestic: null,
                dexLimit: 1_000_000,
            },
            centennialNpcDexTargetRatio: 0.4,
            averageNationGeneralCount: 0,
            nationAverageStats: { leadership: 50, strength: 50, intelligence: 50 },
            nationAverageExperience: 0,
            nationAverageDedication: 0,
            nationAverageDex: [100, 100, 100, 100, 100],
            friendlyGenerals: [general],
            createGeneralId: () => 2,
            turnTermSeconds: 60,
            turnTimeBase: new Date('0190-01-01T00:00:00.000Z'),
            ticksPerSecond: 1,
        } as VolunteerRecruitResolveContext;

        const outcome = resolver.resolve(context, {});
        const createdEffect = outcome.effects.find((effect) => effect.type === 'general:add');
        expect(createdEffect?.type).toBe('general:add');
        if (!createdEffect || createdEffect.type !== 'general:add') {
            return;
        }

        const created = createdEffect.general as General & { affinity?: number; bornYear?: number; deadYear?: number };
        expect(created).toMatchObject({
            name: 'ⓖ장수',
            affinity: 1,
            bornYear: 170,
            deadYear: 200,
            experience: 2_000,
            dedication: 2_000,
            meta: {
                affinity: 1,
                birthYear: 170,
                deathYear: 200,
                npc_org: 4,
                explevel: 0,
                dedlevel: 1,
            },
        });
    });

    it('uses a U30 candidate batch while keeping the Ref volunteer overrides', () => {
        const resolver = new ActionResolver([], environment);
        const turnTimeBase = new Date('0190-01-01T00:00:00.000Z');
        const poolCandidate = parseScenarioGeneralPoolCandidate({
            id: 17,
            uniqueName: '의병후보',
            info: {
                generalName: '의병후보',
                leadership: 70,
                strength: 80,
                intel: 10,
                specialDomestic: 'che_event_징병',
                dex: [11, 22, 33, 44, 55],
                imgsvr: 1,
                picture: 'volunteer.gif',
            },
        });
        const context = {
            general: structuredClone(general),
            nation: structuredClone(nation),
            rng: new RandUtil(new ConstantRNG(0)),
            addLog: () => undefined,
            currentYear: 190,
            currentMonth: 1,
            startYear: 180,
            centennialRules: {
                defaultStatMin: 15,
                defaultStatMax: 80,
                defaultStatTotal: 165,
                maxStatLevel: 255,
                defaultSpecialDomestic: null,
                dexLimit: 1_000_000,
            },
            centennialNpcDexTargetRatio: 0.4,
            averageNationGeneralCount: 0,
            nationAverageStats: { leadership: 50, strength: 50, intelligence: 50 },
            nationAverageExperience: 1_000,
            nationAverageDedication: 1_000,
            nationAverageDex: [100, 100, 100, 100, 100],
            friendlyGenerals: [general],
            generalPool: [poolCandidate],
            existingGeneralNames: ['군주'],
            createGeneralId: () => 2,
            turnTermSeconds: 60,
            turnTimeBase,
            ticksPerSecond: 1,
        } as VolunteerRecruitResolveContext;

        const outcome = resolver.resolve(context, {});
        const createdEffect = outcome.effects.find((effect) => effect.type === 'general:add');
        expect(createdEffect?.type).toBe('general:add');
        if (!createdEffect || createdEffect.type !== 'general:add') {
            return;
        }

        expect(createdEffect.general).toMatchObject({
            name: 'ⓖ의병후보',
            stats: { leadership: 70, strength: 80, intelligence: 10 },
            picture: 'volunteer.gif',
            imageServer: 1,
            role: { specialDomestic: null, specialWar: null },
            meta: {
                dex1: 11,
                dex2: 22,
                dex3: 33,
                dex4: 44,
                dex5: 55,
                scenarioGeneralPoolClaim: {
                    poolEntryId: 17,
                    uniqueName: '의병후보',
                    claimedAt: turnTimeBase.toISOString(),
                },
            },
        });
    });

    it('generates ordinary volunteer stats and dex before applying the S100 .9/.4 target', () => {
        const resolver = new ActionResolver([], environment);
        const turnTimeBase = new Date('0195-01-01T00:00:00.000Z');
        const poolCandidate = parseScenarioGeneralPoolCandidate({
            id: 101,
            uniqueName: 'A1000101',
            info: {
                uniqueName: 'A1000101',
                generalName: '100기의병',
                leadership: 100,
                strength: 80,
                intel: 10,
                specialDomestic: 'che_event_징병',
                dex: [900_000, 800_000, 700_000, 600_000, 500_000],
                imgsvr: 1,
                picture: 'centennial-volunteer.gif',
                event100Growth: true,
            },
        });
        const context = {
            general: structuredClone(general),
            nation: structuredClone(nation),
            rng: new RandUtil(new ConstantRNG(0)),
            addLog: () => undefined,
            currentYear: 195,
            currentMonth: 1,
            startYear: 180,
            centennialRules: {
                defaultStatMin: 15,
                defaultStatMax: 80,
                defaultStatTotal: 165,
                maxStatLevel: 255,
                defaultSpecialDomestic: null,
                dexLimit: 1_000_000,
            },
            centennialNpcDexTargetRatio: 0.4,
            averageNationGeneralCount: 0,
            nationAverageStats: { leadership: 50, strength: 50, intelligence: 50 },
            nationAverageExperience: 1_000,
            nationAverageDedication: 1_000,
            nationAverageDex: [100, 100, 100, 100, 100],
            friendlyGenerals: [general],
            generalPool: [poolCandidate],
            existingGeneralNames: ['군주'],
            createGeneralId: () => 2,
            turnTermSeconds: 60,
            turnTimeBase,
            ticksPerSecond: 1,
        } as VolunteerRecruitResolveContext;

        const outcome = resolver.resolve(context, {});
        const createdEffect = outcome.effects.find((effect) => effect.type === 'general:add');
        expect(createdEffect?.type).toBe('general:add');
        if (!createdEffect || createdEffect.type !== 'general:add') {
            return;
        }

        expect(createdEffect.general).toMatchObject({
            name: 'ⓖ100기의병',
            stats: { leadership: 91, strength: 73, intelligence: 10 },
            role: { specialDomestic: 'che_event_징병' },
            meta: {
                dex1: 360_000,
                dex2: 320_000,
                dex3: 280_000,
                dex4: 240_000,
                dex5: 200_000,
                scenarioGeneralPoolClaim: { poolEntryId: 101, uniqueName: 'A1000101' },
                event100_allstar: { targetId: 'A1000101', milestone: 4, dexTargetRatio: 0.4 },
            },
        });
    });
});
