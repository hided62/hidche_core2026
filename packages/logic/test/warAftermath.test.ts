import { describe, expect, it, vi } from 'vitest';

import { ConstantRNG, RandUtil } from '@sammo-ts/common';

import type { City, General, Nation } from '../src/domain/entities.js';
import type { GeneralActionModule } from '../src/actionModules/general.js';
import type { UnitSetDefinition } from '../src/world/types.js';
import { resolveWarAftermath } from '../src/war/aftermath.js';
import type { WarAftermathConfig } from '../src/war/types.js';
import { LogFormat } from '../src/logging/types.js';
import { buildWarAftermathConfig, buildWarConfig } from '../src/actions/turn/actionContextHelpers.js';
import type { ScenarioConfig } from '../src/scenario/types.js';

const buildUnitSet = (): UnitSetDefinition => ({
    id: 'test',
    name: 'test',
    crewTypes: [
        {
            id: 999,
            armType: 9,
            name: '성벽',
            attack: 0,
            defence: 0,
            speed: 1,
            avoid: 0,
            magicCoef: 0,
            cost: 0,
            rice: 10,
            requirements: [],
            attackCoef: {},
            defenceCoef: {},
            info: [],
            initSkillTrigger: null,
            phaseSkillTrigger: null,
            iActionList: null,
        },
    ],
});

const buildConfig = (): WarAftermathConfig => ({
    initialNationGenLimit: 1,
    techLevelIncYear: 5,
    initialAllowedTechLevel: 1,
    maxTechLevel: 12,
    defaultCityWall: 1000,
    baseGold: 0,
    baseRice: 0,
    castleCrewTypeId: 999,
});

const buildCity = (id: number, nationId: number): City => ({
    id,
    name: `City${id}`,
    nationId,
    level: 2,
    state: 0,
    population: 10000,
    populationMax: 10000,
    agriculture: 1000,
    agricultureMax: 1000,
    commerce: 1000,
    commerceMax: 1000,
    security: 1000,
    securityMax: 1000,
    defence: 100,
    defenceMax: 200,
    supplyState: 1,
    frontState: 0,
    wall: 100,
    wallMax: 200,
    meta: {},
});

const buildNation = (id: number): Nation => ({
    id,
    name: `Nation${id}`,
    color: '#000000',
    capitalCityId: id,
    chiefGeneralId: null,
    gold: 1000,
    rice: 1000,
    power: 0,
    level: 1,
    typeCode: 'test',
    meta: {
        tech: 1000,
    },
});

const buildGeneral = (id: number, nationId: number, cityId: number): General => ({
    id,
    name: `General${id}`,
    nationId,
    cityId,
    troopId: 0,
    stats: {
        leadership: 70,
        strength: 70,
        intelligence: 70,
    },
    experience: 100,
    dedication: 100,
    officerLevel: 3,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: {
            horse: null,
            weapon: null,
            book: null,
            item: null,
        },
    },
    injury: 0,
    gold: 1000,
    rice: 1000,
    crew: 1000,
    crewTypeId: 999,
    train: 80,
    atmos: 80,
    age: 20,
    npcState: 0,
    triggerState: {
        flags: {},
        counters: {},
        modifiers: {},
        meta: {},
    },
    meta: { killturn: 24 },
});

describe('war aftermath', () => {
    it('defaults the omitted legacy maximum tech level to 12', () => {
        const config = buildWarAftermathConfig({ const: {} } as ScenarioConfig, 999);

        expect(config.maxTechLevel).toBe(12);
    });

    it('propagates the scenario maximum tech level to battle and aftermath configs', () => {
        const scenarioConfig: ScenarioConfig = {
            stat: { total: 0, min: 0, max: 0, npcTotal: 0, npcMax: 0, npcMin: 0, chiefMin: 0 },
            iconPath: '',
            map: {},
            const: { maxTechLevel: 15 },
            environment: { mapName: 'test', unitSet: 'test' },
        };

        expect(buildWarConfig(scenarioConfig, buildUnitSet()).maxTechLevel).toBe(15);
        expect(buildWarAftermathConfig(scenarioConfig, 999).maxTechLevel).toBe(15);
    });

    it('uses the scenario maximum tech level for supply-city rice consumption', () => {
        const attackerNation = buildNation(1);
        const defenderNation = buildNation(2);
        defenderNation.meta.tech = 15_000;
        const attackerCity = buildCity(1, 1);
        const defenderCity = buildCity(2, 2);
        defenderCity.meta.supply = 1;
        const attacker = buildGeneral(1, 1, 1);

        resolveWarAftermath({
            battle: {
                attacker,
                defenders: [],
                defenderCity,
                logs: [],
                conquered: false,
                reports: [
                    {
                        id: defenderCity.id,
                        type: 'city',
                        name: defenderCity.name,
                        isAttacker: false,
                        killed: 100,
                        dead: 0,
                        phase: 1,
                    },
                ],
            },
            attackerNation,
            defenderNation,
            attackerCity,
            defenderCity,
            nations: [attackerNation, defenderNation],
            cities: [attackerCity, defenderCity],
            generals: [attacker],
            unitSet: buildUnitSet(),
            config: { ...buildConfig(), maxTechLevel: 15 },
            time: { year: 200, month: 1, startYear: 180 },
        });

        expect(defenderNation.rice).toBe(985);
    });

    it('updates tech and diplomacy deltas', () => {
        const attackerNation = buildNation(1);
        const defenderNation = buildNation(2);
        const attackerCity = buildCity(1, 1);
        const defenderCity = buildCity(2, 2);
        const attacker = buildGeneral(1, 1, 1);

        const outcome = resolveWarAftermath({
            battle: {
                attacker,
                defenders: [],
                defenderCity,
                logs: [],
                conquered: false,
                reports: [
                    {
                        id: attacker.id,
                        type: 'general',
                        name: attacker.name,
                        isAttacker: true,
                        killed: 100,
                        dead: 50,
                    },
                ],
            },
            attackerNation,
            defenderNation,
            attackerCity,
            defenderCity,
            nations: [attackerNation, defenderNation],
            cities: [attackerCity, defenderCity],
            generals: [attacker],
            unitSet: buildUnitSet(),
            config: buildConfig(),
            time: {
                year: 200,
                month: 1,
                startYear: 180,
            },
        });

        expect(attackerNation.meta.tech).toBe(Math.fround(1000.6));
        expect(defenderNation.meta.tech).toBe(Math.fround(1000.9));
        expect(outcome.diplomacyDeltas).toHaveLength(2);
        expect(attackerCity.meta.dead).toBe(60);
        expect(defenderCity.meta.dead).toBe(90);
    });

    it('truncates each city casualty split before accumulating it', () => {
        const attackerNation = buildNation(1);
        const defenderNation = buildNation(2);
        const attackerCity = buildCity(1, 1);
        const defenderCity = buildCity(2, 2);
        attackerCity.meta.dead = 10;
        defenderCity.meta.dead = 20;
        const attacker = buildGeneral(1, 1, 1);

        resolveWarAftermath({
            battle: {
                attacker,
                defenders: [],
                defenderCity,
                logs: [],
                conquered: false,
                reports: [
                    { id: attacker.id, type: 'general', name: attacker.name, isAttacker: true, killed: 101, dead: 52 },
                ],
            },
            attackerNation,
            defenderNation,
            attackerCity,
            defenderCity,
            nations: [attackerNation, defenderNation],
            cities: [attackerCity, defenderCity],
            generals: [attacker],
            unitSet: buildUnitSet(),
            config: buildConfig(),
            time: { year: 200, month: 1, startYear: 180 },
        });

        expect(attackerCity.meta.dead).toBe(71);
        expect(defenderCity.meta.dead).toBe(111);
    });

    it('logs emergency relocation when a surviving nation loses its capital', () => {
        const attackerNation = buildNation(1);
        const defenderNation = buildNation(2);
        const attackerCity = buildCity(1, 1);
        const defenderCity = buildCity(2, 2);
        const nextCapital = buildCity(3, 2);
        const attacker = buildGeneral(1, 1, 1);
        attacker.officerLevel = 12;
        const defender = buildGeneral(2, 2, 2);
        defender.officerLevel = 12;

        const outcome = resolveWarAftermath({
            battle: {
                attacker,
                defenders: [],
                defenderCity,
                logs: [],
                conquered: true,
                reports: [
                    {
                        id: attacker.id,
                        type: 'general',
                        name: attacker.name,
                        isAttacker: true,
                        killed: 10,
                        dead: 5,
                    },
                ],
            },
            attackerNation,
            defenderNation,
            attackerCity,
            defenderCity,
            nations: [attackerNation, defenderNation],
            cities: [attackerCity, defenderCity, nextCapital],
            generals: [attacker, defender],
            unitSet: buildUnitSet(),
            config: buildConfig(),
            time: {
                year: 200,
                month: 1,
                startYear: 180,
            },
        });

        expect(defenderNation.capitalCityId).toBe(nextCapital.id);
        expect(outcome.logs.map((log) => log.text)).toEqual(
            expect.arrayContaining([
                '<M><b>【긴급천도】</b></><D><b>Nation2</b></>가 수도가 함락되어 <G><b>City3</b></>으로 긴급천도하였습니다.',
                '수도가 함락되어 <G><b>City3</b></>으로 <M>긴급천도</>합니다.',
                '수뇌는 <G><b>City3</b></>으로 집합되었습니다.',
            ])
        );
    });

    it('uses the city battle phase, not retained casualties, for conquered supply-city rice', () => {
        const attackerNation = buildNation(1);
        const defenderNation = buildNation(2);
        defenderNation.rice = 6000;
        defenderNation.capitalCityId = 3;
        const attackerCity = buildCity(1, 1);
        const defenderCity = buildCity(2, 2);
        const defenderCapital = buildCity(3, 2);
        defenderCity.meta.supply = 1;
        const attacker = buildGeneral(1, 1, 1);

        resolveWarAftermath({
            battle: {
                attacker,
                defenders: [],
                defenderCity,
                logs: [],
                conquered: true,
                reports: [
                    {
                        id: defenderCity.id,
                        type: 'city',
                        name: defenderCity.name,
                        isAttacker: false,
                        killed: 0,
                        dead: 100,
                        phase: 0,
                    },
                ],
            },
            attackerNation,
            defenderNation,
            attackerCity,
            defenderCity,
            nations: [attackerNation, defenderNation],
            cities: [attackerCity, defenderCity, defenderCapital],
            generals: [attacker],
            unitSet: buildUnitSet(),
            config: buildConfig(),
            time: { year: 200, month: 1, startYear: 180 },
        });

        expect(defenderNation.rice).toBe(6500);
    });

    it('applies conquest collapse rewards', () => {
        const rng = new RandUtil(new ConstantRNG(0));
        const attackerNation = buildNation(1);
        const defenderNation = buildNation(2);
        defenderNation.gold = 5000;
        defenderNation.rice = 6000;
        const attackerCity = buildCity(1, 1);
        const defenderCity = buildCity(2, 2);
        defenderCity.conflict = { 99: 200, 1: 100 };
        const attacker = buildGeneral(1, 1, 1);
        attacker.officerLevel = 12;
        const defender = buildGeneral(2, 2, 2);

        const outcome = resolveWarAftermath({
            battle: {
                attacker,
                defenders: [defender],
                defenderCity,
                logs: [],
                conquered: true,
                reports: [
                    {
                        id: attacker.id,
                        type: 'general',
                        name: attacker.name,
                        isAttacker: true,
                        killed: 10,
                        dead: 5,
                    },
                    {
                        id: defenderCity.id,
                        type: 'city',
                        name: defenderCity.name,
                        isAttacker: false,
                        killed: 0,
                        dead: 0,
                    },
                ],
            },
            attackerNation,
            defenderNation,
            attackerCity,
            defenderCity,
            nations: [attackerNation, defenderNation],
            cities: [attackerCity, defenderCity],
            generals: [attacker, defender],
            unitSet: buildUnitSet(),
            config: buildConfig(),
            time: {
                year: 200,
                month: 1,
                startYear: 180,
            },
            rng,
        });

        expect(outcome.conquest?.nationCollapsed).toBe(true);
        expect(attackerNation.gold).toBe(3600);
        expect(attackerNation.rice).toBe(4600);
        expect(defender.experience).toBe(90);
        expect(defender.dedication).toBe(50);
        // Removed nations can remain in old persisted conflict data. They
        // must never receive ownership during a later conquest.
        expect(defenderCity.nationId).toBe(attackerNation.id);
        expect(defenderCity.conflict).toEqual({});
        expect(outcome.logs.map((log) => log.text)).toEqual(
            expect.arrayContaining([
                '<D><b>Nation2</b></>를 정복',
                '<R><b>【멸망】</b></><D><b>Nation2</b></>는 <R>멸망</>했습니다.',
                '<D><b>Nation2</b></>가 <R>멸망</>했습니다.',
                '<D><b>Nation2</b></> 정복으로 금<C>2,600</> 쌀<C>3,600</>을 획득했습니다.',
            ])
        );
    });

    it('matches ruined-nation lord ordering and NPC appointment draws', () => {
        const attackerNation = buildNation(1);
        const defenderNation = buildNation(2);
        defenderNation.chiefGeneralId = 10;
        const attackerCity = buildCity(1, 1);
        const defenderCity = buildCity(2, 2);
        const attacker = buildGeneral(1, 1, 1);
        const lord = buildGeneral(10, 2, 2);
        const npc = buildGeneral(2, 2, 2);
        npc.npcState = 2;

        const rangeDraws = [0.2, 0.21, 0.4, 0.41];
        const nextBool = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(false);
        const rng = {
            nextRange: vi.fn(() => rangeDraws.shift()!),
            nextBool,
            nextRangeInt: vi.fn(() => 6),
        } as unknown as RandUtil;

        const outcome = resolveWarAftermath({
            battle: {
                attacker,
                defenders: [],
                defenderCity,
                logs: [],
                conquered: true,
                reports: [],
            },
            attackerNation,
            defenderNation,
            attackerCity,
            defenderCity,
            nations: [attackerNation, defenderNation],
            cities: [attackerCity, defenderCity],
            // The caller order deliberately puts the lord first.
            generals: [attacker, lord, npc],
            unitSet: buildUnitSet(),
            config: {
                ...buildConfig(),
                joinMode: 'full',
                joinRuinedNpcProbability: 0.1,
            },
            time: { year: 186, month: 1, startYear: 179 },
            rng,
        });

        expect(npc.gold).toBe(800);
        expect(npc.rice).toBe(790);
        expect(lord.gold).toBe(600);
        expect(lord.rice).toBe(590);
        expect(nextBool.mock.calls.map(([probability]) => probability)).toEqual([0.5, 0.1, 0.5]);
        expect(outcome.conquest?.ruinedNpcJoinPlans).toEqual([
            { generalId: npc.id, destNationId: attackerNation.id, joinTurn: 6 },
        ]);
    });

    it('dispatches city conquest to every stationed defender before collapse RNG', () => {
        const rng = new RandUtil(new ConstantRNG(0));
        const draws = [0.01, 0.02, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
        const nextFloat = vi.spyOn(rng, 'nextFloat1').mockImplementation(() => {
            const value = draws.shift();
            if (value === undefined) {
                throw new Error('unexpected RNG draw');
            }
            return value;
        });
        const attackerNation = buildNation(1);
        const defenderNation = buildNation(2);
        const attackerCity = buildCity(1, 1);
        const defenderCity = buildCity(2, 2);
        const attacker = buildGeneral(1, 1, 1);
        const firstDefender = buildGeneral(2, 2, 2);
        const secondDefender = buildGeneral(3, 2, 2);
        secondDefender.crew = 0;
        const elsewhere = buildGeneral(4, 2, 3);
        const dispatchOrder: number[] = [];
        const module: GeneralActionModule = {
            eventHandlers: {
                'city.conquered': (context, event) => {
                    dispatchOrder.push(context.general.id);
                    context.general.triggerState.meta.conqueredBy = event.payload.attacker.id;
                    context.rng.nextFloat1();
                    context.log?.push(`점령 이벤트 ${context.general.id}`);
                },
            },
        };

        const outcome = resolveWarAftermath({
            battle: {
                attacker,
                defenders: [firstDefender],
                defenderCity,
                logs: [],
                conquered: true,
                reports: [],
            },
            attackerNation,
            defenderNation,
            attackerCity,
            defenderCity,
            nations: [attackerNation, defenderNation],
            cities: [attackerCity, defenderCity],
            generals: [attacker, firstDefender, secondDefender, elsewhere],
            unitSet: buildUnitSet(),
            config: buildConfig(),
            time: {
                year: 200,
                month: 1,
                startYear: 180,
            },
            rng,
            generalActionModules: [module],
        });

        expect(dispatchOrder).toEqual([firstDefender.id, secondDefender.id]);
        expect(firstDefender.triggerState.meta.conqueredBy).toBe(attacker.id);
        expect(secondDefender.triggerState.meta.conqueredBy).toBe(attacker.id);
        expect(elsewhere.triggerState.meta.conqueredBy).toBeUndefined();
        // The first two draws belong to the two event handlers. Collapse then
        // consumes the same stream: 0.2/0.3 for the first defender and
        // 0.4/0.5 for the second.
        expect(firstDefender.gold).toBe(740);
        expect(firstDefender.rice).toBe(710);
        expect(secondDefender.gold).toBe(680);
        expect(secondDefender.rice).toBe(650);
        expect(elsewhere.gold).toBe(620);
        expect(elsewhere.rice).toBe(590);
        expect(nextFloat).toHaveBeenCalledTimes(8);
        expect(draws).toEqual([]);
        expect(outcome.logs.filter((log) => log.text.startsWith('점령 이벤트')).map((log) => log.format)).toEqual([
            LogFormat.MONTH,
            LogFormat.MONTH,
        ]);
        expect(outcome.generals.map((general) => general.id)).toEqual(
            expect.arrayContaining([firstDefender.id, secondDefender.id])
        );
    });

    it('preserves the first contributor when conflict values are tied', () => {
        const attackerNation = buildNation(1);
        const defenderNation = buildNation(2);
        defenderNation.capitalCityId = 5;
        const laterNation = buildNation(3);
        const firstNation = buildNation(4);
        const attackerCity = buildCity(1, 1);
        const defenderCity = buildCity(2, 2);
        defenderCity.conflict = { 3: 100, 4: 100 };
        defenderCity.meta.conflict_order = [4, 3];
        const defenderCapital = buildCity(5, 2);
        const attacker = buildGeneral(1, 1, 1);

        const outcome = resolveWarAftermath({
            battle: {
                attacker,
                defenders: [],
                defenderCity,
                logs: [],
                conquered: true,
                reports: [],
            },
            attackerNation,
            defenderNation,
            attackerCity,
            defenderCity,
            nations: [attackerNation, defenderNation, laterNation, firstNation],
            cities: [attackerCity, defenderCity, defenderCapital],
            generals: [attacker],
            unitSet: buildUnitSet(),
            config: buildConfig(),
            time: {
                year: 200,
                month: 1,
                startYear: 180,
            },
        });

        expect(outcome.conquest?.conquerNationId).toBe(4);
        expect(defenderCity.nationId).toBe(4);
        expect(defenderCity.meta.conflict_order).toEqual([]);
        expect(attacker.cityId).toBe(1);
    });
});
