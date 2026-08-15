import { describe, expect, it } from 'vitest';

import type { CityRow, GeneralRow, NationRow, WorldStateRow } from '../src/context.js';
import type { GeneralActionModule, MapDefinition, UnitSetDefinition } from '@sammo-ts/logic';
import { buildRecruitmentCommandInfo, buildTurnCommandTable } from '../src/turns/commandTable.js';

const buildWorldState = (joinMode = 'full'): WorldStateRow =>
    ({
        id: 1,
        scenarioCode: 'default',
        currentYear: 3,
        currentMonth: 1,
        tickSeconds: 600,
        config: {
            joinMode,
            const: {
                baseGold: 1000,
                baseRice: 1000,
                develCost: 100,
            },
        },
        meta: {
            scenarioMeta: {
                startYear: 1,
            },
        },
        updatedAt: new Date('2026-01-01T00:00:00Z'),
    }) as unknown as WorldStateRow;

const buildGeneral = (): GeneralRow =>
    ({
        id: 1,
        name: 'TestGeneral',
        nationId: 1,
        cityId: 1,
        troopId: 0,
        leadership: 70,
        strength: 60,
        intel: 60,
        experience: 0,
        dedication: 0,
        officerLevel: 6,
        personalCode: null,
        specialCode: null,
        special2Code: null,
        horseCode: null,
        weaponCode: null,
        bookCode: null,
        itemCode: null,
        injury: 0,
        gold: 0,
        rice: 0,
        crew: 100,
        crewTypeId: 1100,
        train: 0,
        atmos: 0,
        age: 25,
        npcState: 0,
        meta: { killturn: 24 },
    }) as unknown as GeneralRow;

const buildCity = (): CityRow =>
    ({
        id: 1,
        name: 'TestCity',
        nationId: 1,
        level: 5,
        population: 100000,
        populationMax: 200000,
        agriculture: 1000,
        agricultureMax: 2000,
        commerce: 1000,
        commerceMax: 2000,
        security: 1000,
        securityMax: 2000,
        supplyState: 1,
        frontState: 0,
        defence: 0,
        defenceMax: 0,
        wall: 0,
        wallMax: 0,
        meta: {},
        trust: 50,
        trade: 0,
        region: 0,
    }) as unknown as CityRow;

const buildNation = (): NationRow =>
    ({
        id: 1,
        name: 'TestNation',
        color: '#000000',
        capitalCityId: 1,
        gold: 0,
        rice: 0,
        level: 1,
        typeCode: 'default',
        tech: 0,
        meta: {},
    }) as unknown as NationRow;

describe('buildTurnCommandTable', () => {
    it('projects the main reserved-turn categories and command order from Ref', async () => {
        const table = await buildTurnCommandTable({
            worldState: buildWorldState(),
            general: buildGeneral(),
            city: buildCity(),
            nation: buildNation(),
            nationGenerals: null,
        });

        expect(table.general.map(({ category }) => category)).toEqual(['개인', '내정', '군사', '인사', '계략', '국가']);
        expect(
            Object.fromEntries(table.general.map(({ category, values }) => [category, values.map(({ key }) => key)]))
        ).toEqual({
            개인: [
                '휴식',
                'che_요양',
                'che_단련',
                'che_숙련전환',
                'che_견문',
                'che_장비매매',
                'che_군량매매',
                'che_내정특기초기화',
                'che_전투특기초기화',
            ],
            내정: [
                'che_농지개간',
                'che_상업투자',
                'che_기술연구',
                'che_수비강화',
                'che_성벽보수',
                'che_치안강화',
                'che_정착장려',
                'che_주민선정',
            ],
            군사: ['che_징병', 'che_모병', 'che_훈련', 'che_사기진작', 'che_출병', 'che_집합', 'che_소집해제'],
            인사: ['che_이동', 'che_인재탐색', 'che_귀환', 'che_임관', 'che_랜덤임관'],
            계략: ['che_화계'],
            국가: ['che_증여', 'che_헌납', 'che_물자조달', 'che_거병', 'che_건국', 'che_선양', 'che_해산'],
        });
    });

    it('uses min-condition constraints for availability', async () => {
        const table = await buildTurnCommandTable({
            worldState: buildWorldState(),
            general: buildGeneral(),
            city: buildCity(),
            nation: buildNation(),
            nationGenerals: null,
        });

        const nationCommand = table.nation
            .flatMap((group) => group.values)
            .find((command) => command.key === 'che_포상');

        expect(nationCommand).toBeDefined();
        expect(nationCommand?.possible).toBe(true);
        expect(nationCommand?.status).not.toBe('blocked');
    });

    it('provides join_mode to reservation availability constraints', async () => {
        const table = await buildTurnCommandTable({
            worldState: buildWorldState('onlyRandom'),
            general: buildGeneral(),
            city: buildCity(),
            nation: buildNation(),
            nationGenerals: null,
        });

        const appointment = table.general
            .flatMap((group) => group.values)
            .find((command) => command.key === 'che_임관');

        expect(appointment).toMatchObject({
            possible: false,
            status: 'blocked',
            reason: '랜덤 임관만 가능합니다',
        });
    });

    it('projects Ref recruitment availability, combat values, descriptions, and adjusted costs', () => {
        const general = buildGeneral();
        general.injury = 3;
        general.gold = 12_345;
        const nation = buildNation();
        nation.tech = 1000;
        const unitSet = {
            id: 'test',
            name: 'test',
            defaultCrewTypeId: 1100,
            armTypes: { 1: '보병' },
            crewTypes: [
                {
                    id: 1100,
                    armType: 1,
                    name: '보병',
                    attack: 100,
                    defence: 150,
                    speed: 7,
                    avoid: 10,
                    magicCoef: 0,
                    cost: 9,
                    rice: 9,
                    requirements: [],
                    attackCoef: {},
                    defenceCoef: {},
                    info: ['표준적인 보병입니다.'],
                    initSkillTrigger: null,
                    phaseSkillTrigger: null,
                    iActionList: null,
                },
                {
                    id: 1101,
                    armType: 1,
                    name: '정예병',
                    attack: 150,
                    defence: 200,
                    speed: 8,
                    avoid: 20,
                    magicCoef: 0,
                    cost: 12,
                    rice: 10,
                    requirements: [{ type: 'ReqTech', tech: 2000 }],
                    attackCoef: {},
                    defenceCoef: {},
                    info: ['강력하지만 기술이 필요합니다.'],
                    initSkillTrigger: null,
                    phaseSkillTrigger: null,
                    iActionList: null,
                },
            ],
        } satisfies UnitSetDefinition;
        const map = {
            id: 'test',
            name: 'test',
            cities: [{ id: 1, name: 'TestCity', region: 1 }],
        } as unknown as MapDefinition;
        const costDiscount: GeneralActionModule = {
            onCalcDomestic: (_context, _turnType, varType, value) => (varType === 'cost' ? value * 0.9 : value),
        };

        const info = buildRecruitmentCommandInfo({
            worldState: buildWorldState(),
            general,
            city: buildCity(),
            nation,
            cities: [buildCity()],
            map,
            unitSet,
            generalActionModules: [costDiscount],
        });

        expect(info).toMatchObject({
            techLevel: 1,
            fullLeadership: 70,
            currentCrewTypeId: 1100,
            currentCrewTypeName: '보병',
            crew: 100,
            gold: 12_345,
        });
        expect(info.leadership).toBeLessThan(info.fullLeadership);
        expect(info.groups).toHaveLength(1);
        expect(info.groups[0]?.values[0]).toMatchObject({
            name: '보병',
            available: true,
            special: false,
            attack: 125,
            defence: 175,
            speed: 7,
            avoid: 10,
            info: ['표준적인 보병입니다.'],
        });
        expect(info.groups[0]?.values[0]?.baseCost).toBeCloseTo(9 * 1.15 * 0.9, 10);
        expect(info.groups[0]?.values[0]?.baseRice).toBeCloseTo(9 * 1.15, 10);
        expect(info.groups[0]?.values[1]).toMatchObject({
            name: '정예병',
            available: false,
            special: true,
            attack: 175,
            defence: 225,
            info: ['강력하지만 기술이 필요합니다.'],
        });
    });
});
