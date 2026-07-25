import { describe, expect, it } from 'vitest';
import type { City, Nation } from '@sammo-ts/logic';

import { composeCalendarHandlers } from '../src/turn/calendarHandlers.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import {
    createMonthlyDiplomacyHandler,
    createMonthlyNationCountHandler,
    createMonthlyNationStatsHandler,
    createMonthlyWarSettingHandler,
} from '../src/turn/monthlyNationStatsHandler.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildGeneral = (options: {
    id: number;
    nationId: number;
    npcState: number;
    gold: number;
    rice: number;
    crew: number;
    leadership: number;
    strength: number;
    intelligence: number;
    experience: number;
    dedication: number;
    dexterity: number[];
    killCrew: number;
    deathCrew: number;
}): TurnGeneral => ({
    id: options.id,
    name: `장수${options.id}`,
    nationId: options.nationId,
    cityId: options.id,
    troopId: 0,
    stats: {
        leadership: options.leadership,
        strength: options.strength,
        intelligence: options.intelligence,
    },
    experience: options.experience,
    dedication: options.dedication,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: options.gold,
    rice: options.rice,
    crew: options.crew,
    crewTypeId: 1100,
    train: 0,
    atmos: 0,
    age: 20,
    npcState: options.npcState,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: {
        killturn: 0,
        dex1: options.dexterity[0] ?? 0,
        dex2: options.dexterity[1] ?? 0,
        dex3: options.dexterity[2] ?? 0,
        dex4: options.dexterity[3] ?? 0,
        dex5: options.dexterity[4] ?? 0,
        rank_killcrew_person: options.killCrew,
        rank_deathcrew_person: options.deathCrew,
    },
    turnTime: new Date('0193-01-01T00:00:00.000Z'),
});

const buildCity = (id: number, nationId: number, scale: number): City => ({
    id,
    name: nationId === 1 ? '갑성' : '을성',
    nationId,
    level: 4,
    state: 0,
    population: 1_000 * scale,
    populationMax: 2_000 * scale,
    agriculture: 100 * scale,
    agricultureMax: 200 * scale,
    commerce: 100 * scale,
    commerceMax: 200 * scale,
    security: 100 * scale,
    securityMax: 200 * scale,
    supplyState: 1,
    frontState: 0,
    defence: 100 * scale,
    defenceMax: 200 * scale,
    wall: 100 * scale,
    wallMax: 200 * scale,
    conflict: {},
    meta: {},
});

const buildNation = (
    id: number,
    patch: Pick<Nation, 'gold' | 'rice' | 'power' | 'level'> & { meta: Nation['meta'] }
): Nation => ({
    id,
    name: id === 1 ? '갑국' : '을국',
    color: '#777777',
    capitalCityId: null,
    chiefGeneralId: null,
    typeCode: 'che_중립',
    ...patch,
});

describe('monthly nation statistics boundary', () => {
    it('matches the fixed legacy power, maxima, war-setting count, and final general cache', async () => {
        const state: TurnWorldState = {
            id: 1,
            currentYear: 193,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0193-01-01T00:00:00.000Z'),
            meta: { hiddenSeed: 'monthly-post-nation-stats-fixture' },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: { id: 'test', name: 'test', cities: [] },
            diplomacy: [],
            events: [],
            initialEvents: [],
            generals: [
                buildGeneral({
                    id: 1,
                    nationId: 1,
                    npcState: 0,
                    gold: 1_000,
                    rice: 2_000,
                    crew: 100,
                    leadership: 50,
                    strength: 40,
                    intelligence: 30,
                    experience: 100,
                    dedication: 200,
                    dexterity: [1_000, 0, 0, 0, 0],
                    killCrew: 100,
                    deathCrew: 0,
                }),
                buildGeneral({
                    id: 2,
                    nationId: 2,
                    npcState: 2,
                    gold: 3_000,
                    rice: 4_000,
                    crew: 200,
                    leadership: 60,
                    strength: 50,
                    intelligence: 40,
                    experience: 300,
                    dedication: 400,
                    dexterity: [2_000, 1_000, 0, 0, 0],
                    killCrew: 0,
                    deathCrew: 100,
                }),
            ],
            cities: [buildCity(1, 1, 1), buildCity(2, 2, 2)],
            nations: [
                buildNation(1, {
                    gold: 10_000,
                    rice: 20_000,
                    power: 7,
                    level: 2,
                    meta: {
                        tech: 100,
                        gennum: 9,
                        available_war_setting_cnt: 1,
                        max_power: {
                            maxPower: 999,
                            maxCrew: 50,
                            maxCities: ['옛도시', '옛도시2'],
                        },
                    },
                }),
                buildNation(2, {
                    gold: 2_000,
                    rice: 3_000,
                    power: 8,
                    level: 1,
                    meta: { tech: 50, gennum: 8 },
                }),
            ],
            troops: [],
        };
        let world: InMemoryTurnWorld | null = null;
        const trace: number[] = [];
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            autoAdvanceDiplomacyMonth: false,
            calendarHandler: composeCalendarHandlers(
                {
                    onMonthChanged: () => {
                        trace.push(world?.getNationById(1)?.power ?? -1);
                    },
                },
                createMonthlyNationStatsHandler({ getWorld: () => world }),
                createMonthlyDiplomacyHandler({ getWorld: () => world }),
                createMonthlyWarSettingHandler({ getWorld: () => world }),
                createMonthlyNationCountHandler({ getWorld: () => world })
            ),
        });

        await world.advanceMonth(new Date('0193-02-01T00:00:00.000Z'));

        expect(trace).toEqual([7]);
        expect(world.getNationById(1)).toMatchObject({
            power: 64,
            meta: {
                power: 64,
                gennum: 1,
                available_war_setting_cnt: 3,
                max_power: {
                    maxPower: 999,
                    maxCrew: 100,
                    maxCities: ['옛도시', '옛도시2'],
                },
            },
        });
        expect(world.getNationById(2)).toMatchObject({
            power: 37,
            meta: {
                power: 37,
                gennum: 1,
                available_war_setting_cnt: 2,
                max_power: {
                    maxPower: 37,
                    maxCrew: 200,
                    maxCities: ['을성'],
                },
            },
        });
    });
});
