import { describe, expect, it } from 'vitest';

import type { City, General, Nation } from '../src/domain/entities.js';
import {
    ActionDefinition as DraftActionDefinition,
    CommandResolver as RecruitmentCommandResolver,
} from '../src/actions/turn/general/che_징병.js';
import { ActionDefinition as MercenaryActionDefinition } from '../src/actions/turn/general/che_모병.js';
import { StrategyCommandResolver, type StrategyActionConfig } from '../src/actions/turn/general/strategyCommand.js';
import { traitModule as recruitTrait } from '../src/actionModules/traits/war/che_징병.js';
import { traitModule as footmanTrait } from '../src/actionModules/traits/war/che_보병.js';
import { traitModule as archerTrait } from '../src/actionModules/traits/war/che_궁병.js';
import { traitModule as cavalryTrait } from '../src/actionModules/traits/war/che_기병.js';
import { traitModule as wizardTrait } from '../src/actionModules/traits/war/che_귀병.js';
import { traitModule as siegeTrait } from '../src/actionModules/traits/war/che_공성.js';
import { traitModule as strategistTrait } from '../src/actionModules/traits/war/che_신산.js';

const buildGeneral = (overrides: Partial<General> = {}): General => ({
    id: 1,
    name: '특기 감사 장수',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    npcState: 0,
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    gold: 100_000,
    rice: 100_000,
    crew: 0,
    crewTypeId: 1,
    train: 0,
    atmos: 0,
    injury: 0,
    age: 30,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: 'che_징병',
        items: { horse: null, weapon: null, book: null, item: null },
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    ...overrides,
});

const buildNation = (): Nation => ({
    id: 1,
    name: '특기 감사국',
    color: '#000000',
    capitalCityId: 1,
    chiefGeneralId: 1,
    gold: 100_000,
    rice: 100_000,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: { tech: 0 },
});

const buildCity = (): City => ({
    id: 2,
    name: '특기 감사성',
    nationId: 2,
    level: 1,
    state: 0,
    population: 10_000,
    populationMax: 20_000,
    agriculture: 1_000,
    agricultureMax: 2_000,
    commerce: 1_000,
    commerceMax: 2_000,
    security: 1_000,
    securityMax: 2_000,
    defence: 500,
    defenceMax: 1_000,
    wall: 500,
    wallMax: 1_000,
    supplyState: 1,
    frontState: 0,
    meta: { trust: 50 },
});

describe('전투 특기의 비전투 커맨드 효과', () => {
    it('징병 특기가 징병과 모병의 훈련·사기를 각각 70과 84로 설정한다', () => {
        const context = { general: buildGeneral(), nation: buildNation() };
        const draft = new RecruitmentCommandResolver([recruitTrait], {
            actionName: '징병',
            defaultTrain: 40,
            defaultAtmos: 40,
        });
        const mercenary = new RecruitmentCommandResolver([recruitTrait], {
            actionName: '모병',
            costOffset: 2,
            defaultTrain: 70,
            defaultAtmos: 70,
        });

        expect(draft.getTrain(context)).toBe(70);
        expect(draft.getAtmos(context)).toBe(70);
        expect(mercenary.getTrain(context)).toBe(84);
        expect(mercenary.getAtmos(context)).toBe(84);
    });

    it('실제 징병·모병 action이 특기 훈사와 인구 보존을 저장 상태에 반영한다', () => {
        const unitSet = {
            id: 'war-trait-command-audit',
            name: '전투특기 커맨드 감사',
            crewTypes: [{ id: 101, name: '감사병', armType: 1, cost: 10, rice: 1, requirements: [] }],
        };
        const map = { id: 'war-trait-command-audit', name: '전투특기 커맨드 감사', cities: [] };

        for (const [definition, expectedReadiness] of [
            [new DraftActionDefinition([recruitTrait], {}), 70],
            [new MercenaryActionDefinition([recruitTrait]), 84],
        ] as const) {
            const general = buildGeneral();
            const city = { ...buildCity(), id: 1, nationId: 1, population: 100_000 };
            definition.resolve(
                {
                    general,
                    city,
                    nation: buildNation(),
                    map,
                    unitSet,
                    cities: [city],
                    addLog: () => undefined,
                } as never,
                { crewType: 101, amount: 1_000 }
            );

            expect(general.crew).toBe(1_000);
            expect(general.train).toBe(expectedReadiness);
            expect(general.atmos).toBe(expectedReadiness);
            expect(city.population).toBe(100_000);
        }
    });

    it('징병 특기가 통솔 상한을 25% 높이고 징병 인구를 소모하지 않는다', () => {
        const context = { general: buildGeneral(), nation: buildNation() };
        const command = new RecruitmentCommandResolver([recruitTrait], { actionName: '징병' });

        expect(command.resolveLeadership(context)).toBe(100);
        expect(command.resolveCrewPlan(context, 2, 20_000)).toEqual({ requested: 20_000, applied: 10_000 });
        expect(command.getRecruitPopulation(context, 10_000)).toBe(0);
    });

    it.each([
        ['che_보병', footmanTrait, 1],
        ['che_궁병', archerTrait, 2],
        ['che_기병', cavalryTrait, 3],
        ['che_귀병', wizardTrait, 4],
        ['che_공성', siegeTrait, 5],
    ] as const)('%s 특기가 해당 계통의 징병·모병 비용만 10% 낮춘다', (_key, trait, armType) => {
        const context = { general: buildGeneral(), nation: buildNation() };
        const crewTypeId = 100 + armType;
        const command = new RecruitmentCommandResolver([trait], {
            actionName: '모병',
            costOffset: 2,
            defaultTrain: 70,
            defaultAtmos: 70,
        });

        expect(command.getCost(context, crewTypeId, 1_000, { armType, cost: 10 }).gold).toBe(180);
        expect(command.getCost(context, crewTypeId, 1_000, { armType: 9, cost: 10 }).gold).toBe(200);
    });

    it.each([
        ['che_화계', '화계', 'intelligence', 'fire', true],
        ['che_선동', '선동', 'leadership', 'agitate', true],
        ['che_파괴', '파괴', 'strength', 'destroy', true],
        ['che_탈취', '탈취', 'strength', 'seize', false],
    ] as const)('신산 특기가 %s 성공 공격값을 10%p 높인다', (key, name, statKey, damageMode, injuryGeneral) => {
        const config: StrategyActionConfig = {
            key,
            name,
            statKey,
            statExpKey:
                statKey === 'intelligence' ? 'intel_exp' : statKey === 'leadership' ? 'leadership_exp' : 'strength_exp',
            damageMode,
            injuryGeneral,
        };
        const env = {
            develCost: 100,
            sabotageDefaultProb: 0.5,
            sabotageProbCoefByStat: 300,
            sabotageDefenceCoefByGeneralCount: 0.1,
            sabotageDamageMin: 10,
            sabotageDamageMax: 20,
        };
        const general = buildGeneral();
        const context = {
            general,
            city: { ...buildCity(), id: 1, nationId: 1 },
            nation: buildNation(),
            destCity: buildCity(),
            destNation: { ...buildNation(), id: 2 },
            destGenerals: [],
            distance: 1,
        };
        const base = general.stats[statKey] / env.sabotageProbCoefByStat;

        expect(new StrategyCommandResolver([strategistTrait], env, config).getProbability(context).attack).toBeCloseTo(
            base + 0.1,
            12
        );
    });
});
