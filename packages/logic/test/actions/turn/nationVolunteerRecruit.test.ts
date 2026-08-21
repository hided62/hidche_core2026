import { ConstantRNG, RandUtil } from '@sammo-ts/common';
import { describe, expect, it } from 'vitest';

import type { General, Nation } from '../../../src/domain/entities.js';
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
            averageNationGeneralCount: 0,
            nationAverageStats: { leadership: 50, strength: 50, intelligence: 50 },
            nationAverageExperience: 1_000,
            nationAverageDedication: 1_000,
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

        const created = createdEffect.general as General & { bornYear?: number; deadYear?: number };
        expect(created).toMatchObject({
            name: 'ⓖ장수',
            bornYear: 170,
            deadYear: 200,
            meta: {
                birthYear: 170,
                deathYear: 200,
            },
        });
    });
});
