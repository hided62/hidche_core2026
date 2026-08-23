import { ConstantRNG, RandUtil } from '@sammo-ts/common';
import { describe, expect, it } from 'vitest';

import { ActionResolver, type TalentScoutResolveContext } from '../../../src/actions/turn/general/che_인재탐색.js';
import { parseScenarioGeneralPoolCandidate } from '../../../src/actions/turn/generalPool.js';
import type { City, General } from '../../../src/domain/entities.js';

const general: General = {
    id: 1,
    name: '탐색자',
    nationId: 1,
    cityId: 3,
    troopId: 0,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    experience: 1_000,
    dedication: 1_000,
    officerLevel: 1,
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

const city: City = {
    id: 3,
    name: '탐색도시',
    nationId: 1,
    level: 4,
    state: 0,
    population: 10_000,
    populationMax: 20_000,
    agriculture: 1_000,
    agricultureMax: 2_000,
    commerce: 1_000,
    commerceMax: 2_000,
    security: 1_000,
    securityMax: 2_000,
    supplyState: 1,
    frontState: 0,
    defence: 1_000,
    defenceMax: 2_000,
    wall: 1_000,
    wallMax: 2_000,
    meta: {},
};

describe('talent scout scenario general pool', () => {
    it('keeps the U30 fixed stats and dex while applying the Ref scout overrides', () => {
        const resolver = new ActionResolver([], {
            develCost: 100,
            maxGeneral: 100,
            defaultNpcGold: 1_000,
            defaultNpcRice: 1_000,
            defaultCrewTypeId: 0,
            defaultSpecialDomestic: null,
            defaultSpecialWar: null,
            availablePersonalities: ['che_안전'],
        });
        const turnTimeBase = new Date('0190-01-01T00:00:00.000Z');
        const poolCandidate = parseScenarioGeneralPoolCandidate({
            id: 23,
            uniqueName: '탐색후보',
            info: {
                generalName: '탐색후보',
                leadership: 70,
                strength: 80,
                intel: 10,
                specialDomestic: 'che_event_징병',
                dex: [12, 24, 36, 48, 60],
                imgsvr: 1,
                picture: 'scout.gif',
            },
        });
        const context = {
            general: structuredClone(general),
            rng: new RandUtil(new ConstantRNG(0)),
            addLog: () => undefined,
            currentYear: 190,
            currentMonth: 1,
            startYear: 180,
            retirementYear: 80,
            centennialRules: {
                defaultStatMin: 15,
                defaultStatMax: 80,
                defaultStatTotal: 165,
                maxStatLevel: 255,
                defaultSpecialDomestic: null,
                dexLimit: 1_000_000,
            },
            centennialNpcDexTargetRatio: 0.4,
            worldSummary: {
                totalGeneralCount: 0,
                totalNpcCount: 0,
                averageStats: { leadership: 50, strength: 50, intelligence: 50 },
                averageDex: [100, 100, 100, 100, 100],
            },
            generalPool: [poolCandidate],
            cityPool: [city],
            existingGeneralNames: ['탐색자'],
            createGeneralId: () => 2,
            turnTermMinutes: 10,
            turnTimeBase,
            ticksPerSecond: 1,
        } as TalentScoutResolveContext;

        const outcome = resolver.resolve(context, {});
        const createdEffect = outcome.effects.find((effect) => effect.type === 'general:add');
        expect(createdEffect?.type).toBe('general:add');
        if (!createdEffect || createdEffect.type !== 'general:add') {
            return;
        }

        expect(createdEffect.general).toMatchObject({
            name: 'ⓜ탐색후보',
            stats: { leadership: 70, strength: 80, intelligence: 10 },
            picture: 'scout.gif',
            imageServer: 1,
            role: { specialDomestic: null, specialWar: null },
            meta: {
                npc_org: 3,
                dex1: 12,
                dex2: 24,
                dex3: 36,
                dex4: 48,
                dex5: 60,
                scenarioGeneralPoolClaim: {
                    poolEntryId: 23,
                    uniqueName: '탐색후보',
                    claimedAt: turnTimeBase.toISOString(),
                },
            },
        });
    });

    it('generates ordinary stats and dex before applying the S100 .9/.4 target', () => {
        const resolver = new ActionResolver([], {
            develCost: 100,
            maxGeneral: 100,
            defaultNpcGold: 1_000,
            defaultNpcRice: 1_000,
            defaultCrewTypeId: 0,
            defaultSpecialDomestic: null,
            defaultSpecialWar: null,
            availablePersonalities: ['che_안전'],
        });
        const turnTimeBase = new Date('0195-01-01T00:00:00.000Z');
        const poolCandidate = parseScenarioGeneralPoolCandidate({
            id: 100,
            uniqueName: 'A1000100',
            info: {
                uniqueName: 'A1000100',
                generalName: '100기탐색',
                leadership: 100,
                strength: 80,
                intel: 10,
                specialDomestic: 'che_event_징병',
                dex: [900_000, 800_000, 700_000, 600_000, 500_000],
                imgsvr: 1,
                picture: 'centennial-scout.gif',
                event100Growth: true,
            },
        });
        const context = {
            general: structuredClone(general),
            rng: new RandUtil(new ConstantRNG(0)),
            addLog: () => undefined,
            currentYear: 195,
            currentMonth: 1,
            startYear: 180,
            retirementYear: 80,
            centennialRules: {
                defaultStatMin: 15,
                defaultStatMax: 80,
                defaultStatTotal: 165,
                maxStatLevel: 255,
                defaultSpecialDomestic: null,
                dexLimit: 1_000_000,
            },
            centennialNpcDexTargetRatio: 0.4,
            worldSummary: {
                totalGeneralCount: 0,
                totalNpcCount: 0,
                averageStats: { leadership: 50, strength: 50, intelligence: 50 },
                averageDex: [100, 100, 100, 100, 100],
            },
            generalPool: [poolCandidate],
            cityPool: [city],
            existingGeneralNames: ['탐색자'],
            createGeneralId: () => 2,
            turnTermMinutes: 10,
            turnTimeBase,
            ticksPerSecond: 1,
        } as TalentScoutResolveContext;

        const outcome = resolver.resolve(context, {});
        const createdEffect = outcome.effects.find((effect) => effect.type === 'general:add');
        expect(createdEffect?.type).toBe('general:add');
        if (!createdEffect || createdEffect.type !== 'general:add') {
            return;
        }

        expect(createdEffect.general).toMatchObject({
            name: 'ⓜ100기탐색',
            stats: { leadership: 91, strength: 73, intelligence: 10 },
            role: { specialDomestic: 'che_event_징병' },
            meta: {
                dex1: 360_000,
                dex2: 320_000,
                dex3: 280_000,
                dex4: 240_000,
                dex5: 200_000,
                scenarioGeneralPoolClaim: { poolEntryId: 100, uniqueName: 'A1000100' },
                event100_allstar: { targetId: 'A1000100', milestone: 4, dexTargetRatio: 0.4 },
            },
        });
    });
});
