import { describe, expect, it } from 'vitest';
import { LEGACY_RANK_DATA_TYPES } from '@sammo-ts/common';
import type { TurnSchedule } from '@sammo-ts/logic';

import { rankMetaKey } from '../src/turn/rankData.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnTestHarness } from './helpers/turnTestHarness.js';

const start = new Date('0200-01-01T00:00:00.000Z');
const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
const map = {
    id: 'general-lifecycle',
    name: '장수 lifecycle',
    cities: [
        {
            id: 1,
            name: '테스트성',
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [],
            max: {
                population: 50_000,
                agriculture: 1_000,
                commerce: 1_000,
                security: 1_000,
                defence: 1_000,
                wall: 1_000,
            },
            initial: {
                population: 10_000,
                agriculture: 500,
                commerce: 500,
                security: 500,
                defence: 500,
                wall: 500,
            },
        },
    ],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const makeGeneral = (patch: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id: 1,
    userId: 'user-1',
    name: '테스트장수',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    experience: 100,
    dedication: 80,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 2_000,
    rice: 2_000,
    crew: 0,
    crewTypeId: 1,
    train: 40,
    atmos: 40,
    age: 30,
    npcState: 0,
    bornYear: 170,
    deadYear: 260,
    affinity: 50,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    turnTime: start,
    ...patch,
});

const makeSnapshot = (generals: TurnGeneral[]): TurnWorldSnapshot => ({
    scenarioConfig: {
        stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
        iconPath: '',
        map: {},
        const: {
            develCost: 100,
            trainDelta: 30,
            atmosDelta: 30,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            initialNationGenLimit: 10,
            incDefSettingChange: 3,
            maxDefSettingChange: 9,
            retirementYear: 80,
        },
        environment: { mapName: map.id, unitSet: 'test' },
    },
    scenarioMeta: {
        title: '장수 lifecycle',
        startYear: 200,
        life: null,
        fiction: 0,
        history: [],
        ignoreDefaultEvents: false,
    },
    map,
    unitSet: { id: 'test', name: 'test', crewTypes: [] },
    nations: [
        {
            id: 1,
            name: '테스트국',
            color: '#000000',
            capitalCityId: 1,
            chiefGeneralId: 1,
            gold: 10_000,
            rice: 10_000,
            power: 0,
            level: 1,
            typeCode: 'che_중립',
            meta: { gennum: generals.length, tech: 0 },
        },
    ],
    cities: [
        {
            id: 1,
            name: '테스트성',
            nationId: 1,
            level: 1,
            state: 0,
            population: 10_000,
            populationMax: 50_000,
            agriculture: 500,
            agricultureMax: 1_000,
            commerce: 500,
            commerceMax: 1_000,
            security: 500,
            securityMax: 1_000,
            supplyState: 1,
            frontState: 0,
            defence: 500,
            defenceMax: 1_000,
            wall: 500,
            wallMax: 1_000,
            meta: { trust: 50, trade: 100, region: 1 },
        },
    ],
    generals,
    troops: [],
    diplomacy: [],
    events: [],
    initialEvents: [],
});

const makeState = (meta: Record<string, unknown> = {}): TurnWorldState => ({
    id: 1,
    currentYear: 200,
    currentMonth: 1,
    tickSeconds: 600,
    lastTurnTime: start,
    meta: { killturn: 24, ...meta },
});

describe('legacy general turn lifecycle', () => {
    it('emits legacy plain logs when command gains cross experience and dedication levels', async () => {
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot([
                makeGeneral({
                    injury: 10,
                    experience: 995,
                    dedication: 899,
                    meta: { killturn: 24, explevel: 9, dedlevel: 3 },
                }),
            ]),
            state: makeState(),
            schedule,
            map,
        });
        harness.reservedTurnStore.getGeneralTurns(1)[0] = { action: 'che_요양', args: {} };

        await harness.runOneTick();

        const logTexts = harness.world.peekDirtyState().logs.map((log) => log.text);
        expect(logTexts).toContain('<C>Lv 10</>으로 <C>레벨업</>!');
        expect(logTexts).toContain('<Y>27품관</>으로 <C>승급</>하여 봉록이 <C>1,200</>으로 <C>상승</>했습니다!');
    });

    it('runs preprocess before commands and restores crew population when rice is insufficient', async () => {
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot([makeGeneral({ injury: 25, crew: 200, rice: 1 })]),
            state: makeState(),
            schedule,
            map,
        });

        await harness.runOneTick();

        const general = harness.world.getGeneralById(1)!;
        expect(general.injury).toBe(15);
        expect(general.crew).toBe(0);
        expect(general.rice).toBe(0);
        expect(general.meta.inherit_lived_month).toBe(1);
        expect(harness.world.getCityById(1)!.population).toBe(10_200);
    });

    it('skips blocked commands, decreases killturn once, and advances the queue', async () => {
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot([makeGeneral({ injury: 20, meta: { killturn: 5, block: 3 } })]),
            state: makeState(),
            schedule,
            map,
        });
        harness.reservedTurnStore.getGeneralTurns(1)[0] = { action: 'che_요양', args: {} };

        await harness.runOneTick();

        const general = harness.world.getGeneralById(1)!;
        expect(general.injury).toBe(10);
        expect(general.experience).toBe(100);
        expect(general.meta.killturn).toBe(4);
        expect(general.meta.myset).toBe(3);
        expect(harness.reservedTurnStore.getGeneralTurn(1, 0).action).toBe('휴식');
    });

    it('updates killturn, autorun_limit, myset, and nextTurnTimeBase with legacy branches', async () => {
        const general = makeGeneral({
            injury: 20,
            meta: { killturn: 3, myset: 8, nextTurnTimeBase: 30 },
        });
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot([general]),
            state: makeState({ autorun_user: { limit_minutes: 60, options: {} } }),
            schedule,
            map,
        });
        harness.reservedTurnStore.getGeneralTurns(1)[0] = { action: 'che_요양', args: {} };

        await harness.runOneTick();

        const updated = harness.world.getGeneralById(1)!;
        expect(updated.meta.killturn).toBe(24);
        expect(updated.meta.myset).toBe(9);
        expect(updated.meta.autorun_limit).toBe(2406);
        expect(updated.meta.nextTurnTimeBase).toBeUndefined();
        expect(updated.turnTime.toISOString()).toBe('0200-01-01T00:10:30.000Z');
    });

    it('detaches an expired possessed NPC instead of deleting its body', async () => {
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot([
                makeGeneral({
                    npcState: 1,
                    deadYear: 205,
                    meta: { killturn: 1, npc_org: 3, owner_name: '소유자' },
                }),
            ]),
            state: makeState(),
            schedule,
            map,
        });

        await harness.runOneTick();

        const updated = harness.world.getGeneralById(1)!;
        expect(updated.userId).toBeNull();
        expect(updated.npcState).toBe(3);
        expect(updated.meta.killturn).toBe(60);
        expect(updated.meta.defence_train).toBe(80);
        expect(harness.world.peekDirtyState().lifecycleEvents[0]?.outcome).toBe('detached');
    });

    it('deletes a zero-killturn general, clears its troop, and appoints a successor', async () => {
        const leader = makeGeneral({
            troopId: 1,
            officerLevel: 12,
            meta: { killturn: 1 },
        });
        const successor = makeGeneral({
            id: 2,
            userId: 'user-2',
            name: '후계자',
            troopId: 1,
            officerLevel: 9,
            dedication: 200,
            meta: { killturn: 24 },
        });
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot([leader, successor]),
            state: makeState(),
            schedule,
            map,
        });

        await harness.runOneTick();

        expect(harness.world.getGeneralById(1)).toBeNull();
        expect(harness.world.getGeneralById(2)!.troopId).toBe(0);
        expect(harness.world.getGeneralById(2)!.officerLevel).toBe(12);
        expect(harness.world.getNationById(1)!.chiefGeneralId).toBe(2);
        expect(harness.world.peekDirtyState().deletedGenerals).toContain(1);
    });

    it('keeps compatibility fixtures without legacy lifespan metadata alive', async () => {
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot([
                makeGeneral({
                    deadYear: undefined,
                    npcState: 2,
                    meta: { killturn: 1 },
                }),
            ]),
            state: makeState(),
            schedule,
            map,
        });

        await harness.runOneTick();

        expect(harness.world.getGeneralById(1)).not.toBeNull();
        expect(harness.world.getGeneralById(1)!.meta.killturn).toBe(0);
        expect(harness.world.peekDirtyState().lifecycleEvents[0]?.outcome).toBe('active');
    });

    it('retires a player general and resets inherited stats and rank state', async () => {
        const legacyRankMeta = Object.fromEntries(
            LEGACY_RANK_DATA_TYPES.map((type, index) => [rankMetaKey(type), index + 1])
        );
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot([
                makeGeneral({
                    age: 80,
                    stats: { leadership: 80, strength: 70, intelligence: 60 },
                    experience: 101,
                    dedication: 81,
                    meta: {
                        ...legacyRankMeta,
                        killturn: 24,
                        dex1: 101,
                        inherit_lived_month: 10,
                        inherit_active_action: 4,
                    },
                }),
            ]),
            state: makeState(),
            schedule,
            map,
        });

        await harness.runOneTick();

        const updated = harness.world.getGeneralById(1)!;
        expect(updated.age).toBe(20);
        expect(updated.stats).toEqual({ leadership: 68, strength: 60, intelligence: 51 });
        expect(updated.experience).toBe(51);
        expect(updated.dedication).toBe(41);
        expect(updated.meta.dex1).toBe(51);
        expect(updated.meta.inherit_lived_month).toBe(0);
        expect(updated.meta.inherit_active_action).toBe(0);
        for (const type of LEGACY_RANK_DATA_TYPES) {
            expect(updated.meta[rankMetaKey(type)], type).toBe(0);
        }
        expect(harness.world.peekDirtyState().lifecycleEvents[0]?.outcome).toBe('retired');
    });
});
