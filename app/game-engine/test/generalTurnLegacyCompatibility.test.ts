import { describe, expect, it } from 'vitest';
import { ConstantRNG, RandUtil } from '@sammo-ts/common';
import type { TurnSchedule } from '@sammo-ts/logic/turn/calendar.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnTestHarness } from './helpers/turnTestHarness.js';
import { applyLegacyGeneralProgression } from '../src/turn/reservedTurnHandler.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';

const start = new Date('0200-01-01T00:00:00.000Z');
const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
const map = {
    id: 'general-turn-test',
    name: '장수턴 테스트',
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
    name: '테스트장수',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    experience: 0,
    dedication: 0,
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
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    turnTime: start,
    ...patch,
});

const makeSnapshot = (
    general: TurnGeneral,
    extras: { generals?: TurnGeneral[]; troops?: TurnWorldSnapshot['troops'] } = {}
): TurnWorldSnapshot => ({
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
        },
        environment: { mapName: map.id, unitSet: 'test' },
    },
    scenarioMeta: {
        title: '장수턴 테스트',
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
            chiefGeneralId: null,
            gold: 10_000,
            rice: 10_000,
            power: 0,
            level: 1,
            typeCode: 'che_중립',
            meta: { gennum: 1, tech: 0 },
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
    generals: [general, ...(extras.generals ?? [])],
    troops: extras.troops ?? [],
    diplomacy: [],
    events: [],
    initialEvents: [],
});

const makeState = (): TurnWorldState => ({
    id: 1,
    currentYear: 200,
    currentMonth: 1,
    tickSeconds: 600,
    lastTurnTime: start,
    meta: { killturn: 24 },
});

describe('legacy general-turn execution contract', () => {
    it('does not reuse the join stat allocation maximum as the runtime level cap', () => {
        const previous = makeGeneral({
            experience: 144_000,
            meta: { killturn: 24, explevel: 120 },
        });
        const afterRecruitment = makeGeneral({
            experience: 144_001,
            meta: { killturn: 24, explevel: 120 },
        });
        const env = buildCommandEnv(makeSnapshot(previous).scenarioConfig);

        expect(env.maxStatLevel).toBe(255);
        expect(applyLegacyGeneralProgression(afterRecruitment, previous, 'che_모병', env, []).meta.explevel).toBe(120);
    });

    it('preserves the battle-computed level across legacy INT rounding', () => {
        const previous = makeGeneral({
            experience: 6_700,
            dedication: 5_800,
            meta: { killturn: 24, explevel: 25, dedlevel: 8 },
        });
        const roundedAfterBattle = makeGeneral({
            experience: 6_760,
            dedication: 5_871,
            meta: { killturn: 24, explevel: 25, dedlevel: 8 },
        });

        const resolved = applyLegacyGeneralProgression(
            roundedAfterBattle,
            previous,
            'che_출병',
            { maxStatLevel: 255, maxDedicationLevel: 30 } as never,
            []
        );

        expect(resolved.meta).toMatchObject({ explevel: 25, dedlevel: 8 });
    });

    it('preserves procurement-computed levels while emitting their Ref progression logs', () => {
        const previous = makeGeneral({
            experience: 995,
            dedication: 899,
            meta: { killturn: 24, explevel: 9, dedlevel: 3 },
        });
        const afterProcurement = makeGeneral({
            experience: 1_005,
            dedication: 901,
            meta: { killturn: 24, explevel: 10, dedlevel: 4 },
        });
        const logs: Array<{ text: string }> = [];

        const resolved = applyLegacyGeneralProgression(
            afterProcurement,
            previous,
            'che_물자조달',
            { maxStatLevel: 255, maxDedicationLevel: 30 } as never,
            logs as never
        );

        expect(resolved.meta).toMatchObject({ explevel: 10, dedlevel: 4 });
        expect(logs.map((entry) => entry.text)).toEqual([
            '<C>Lv 10</>으로 <C>레벨업</>!',
            '<Y>27품관</>으로 <C>승급</>하여 봉록이 <C>1,200</>으로 <C>상승</>했습니다!',
        ]);
    });

    it('quantizes integer general columns at each in-memory DB mutation boundary', async () => {
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot(makeGeneral()),
            state: makeState(),
            schedule,
            map,
        });

        harness.world.updateGeneral(1, {
            experience: 10.5,
            dedication: 20.49,
            gold: 1_000.5,
            rice: 1_000.49,
            meta: { killturn: 24, dex4: 100.5, intel_exp: 29.5 },
        });

        expect(harness.world.getGeneralById(1)).toMatchObject({
            experience: 11,
            dedication: 20,
            gold: 1_001,
            rice: 1_000,
            meta: { killturn: 24, dex4: 101, intel_exp: 30 },
        });
    });

    it('fails closed instead of silently resting on an unknown queued command', async () => {
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot(makeGeneral()),
            state: makeState(),
            schedule,
            map,
        });
        harness.reservedTurnStore.getGeneralTurns(1)[0] = { action: 'unknown-command', args: {} };
        const beforeGeneral = structuredClone(harness.world.getGeneralById(1));
        const beforeTurns = structuredClone(harness.reservedTurnStore.getGeneralTurns(1));

        await expect(harness.runOneTick()).rejects.toThrow('Unknown reserved general turn command: unknown-command');
        expect(harness.world.getGeneralById(1)).toEqual(beforeGeneral);
        expect(harness.reservedTurnStore.getGeneralTurns(1)).toEqual(beforeTurns);
        expect(harness.world.peekDirtyState()).toMatchObject({ logs: [], messages: [] });
    });

    it('keeps fractional nation rewards in the same general object until the following command is persisted', async () => {
        const twoCityMap = {
            ...map,
            cities: [
                { ...map.cities[0]!, connections: [2] },
                { ...map.cities[0]!, id: 2, name: '두번째성', position: { x: 1, y: 0 }, connections: [1] },
            ],
        };
        const general = makeGeneral({
            officerLevel: 12,
            stats: { leadership: 80, strength: 70, intelligence: 52 },
            role: {
                personality: 'che_출세',
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null },
            },
        });
        const snapshot = makeSnapshot(general);
        snapshot.map = twoCityMap;
        snapshot.cities.push({
            ...snapshot.cities[0]!,
            id: 2,
            name: '두번째성',
        });
        snapshot.nations[0] = {
            ...snapshot.nations[0]!,
            chiefGeneralId: 1,
            meta: {
                gennum: 1,
                tech: 0,
                capset: 0,
                turn_last_12: {
                    command: '천도',
                    arg: { destCityID: 2 },
                    term: 2,
                    seq: 0,
                },
            },
        };
        const harness = await createTurnTestHarness({
            snapshot,
            state: makeState(),
            schedule,
            map: twoCityMap,
            commandRngFactory: () => new RandUtil(new ConstantRNG(0)),
        });
        harness.reservedTurnStore.getNationTurns(1, 12)[0] = {
            action: 'che_천도',
            args: { destCityID: 2 },
        };
        harness.reservedTurnStore.getGeneralTurns(1)[0] = { action: 'che_상업투자', args: {} };

        await harness.runOneTick();

        // 천도 15 * 1.1 = 16.5, 상업 투자 6 * 0.7 * 1.1 = 4.62.
        // Ref keeps 21.12 in the PHP object and rounds it once at persistence.
        expect(harness.world.getGeneralById(1)?.experience).toBe(21);
        expect(harness.world.getNationById(1)?.capitalCityId).toBe(2);
    });

    it('applies inherited domestic stat progression after farming', async () => {
        const general = makeGeneral({ meta: { killturn: 24, intel_exp: 29 } });
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot(general),
            state: makeState(),
            schedule,
            map,
        });
        harness.reservedTurnStore.getGeneralTurns(1)[0] = { action: 'che_농지개간', args: {} };

        await harness.runOneTick();

        expect(harness.world.getGeneralById(1)).toMatchObject({
            stats: { leadership: 80, strength: 70, intelligence: 61 },
            meta: { intel_exp: 0 },
        });
    });

    it('runs injury recovery and troop rice consumption before the reserved command', async () => {
        const general = makeGeneral({ injury: 25, crew: 200, rice: 1 });
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot(general),
            state: makeState(),
            schedule,
            map,
            collectLogs: true,
        });
        await harness.runOneTick();

        const updated = harness.world.getGeneralById(1)!;
        expect(updated.injury).toBe(15);
        expect(updated.crew).toBe(0);
        expect(updated.rice).toBe(0);
        expect(harness.world.getCityById(1)!.population).toBe(10_200);
        expect(harness.getCollectedLogs().some((log) => log.text.includes('소집해제'))).toBe(true);
    });

    it('persists pre-turn stacking and applies the inherited 60-turn cooldown', async () => {
        const general = makeGeneral({
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: 'che_격노',
                items: { horse: null, weapon: null, book: null, item: null },
            },
        });
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot(general),
            state: makeState(),
            schedule,
            map,
            collectLogs: true,
        });
        const turns = harness.reservedTurnStore.getGeneralTurns(1);
        turns[0] = { action: 'che_전투특기초기화', args: {} };
        turns[1] = { action: 'che_전투특기초기화', args: {} };

        await harness.runOneTick();
        expect(harness.world.getGeneralById(1)!.lastTurn).toEqual({
            command: '전투 특기 초기화',
            term: 1,
        });
        expect(harness.world.getGeneralById(1)!.role.specialWar).toBe('che_격노');

        await harness.runOneTick();
        const updated = harness.world.getGeneralById(1)!;
        expect(updated.role.specialWar).toBeNull();
        expect(updated.meta['next_execute_전투 특기 초기화']).toBe(2460);
        expect(updated.meta.prev_types_special2).toEqual(['che_격노']);
    });

    it('preserves the legacy battle-readiness term reset instead of making its reward reachable', async () => {
        const general = makeGeneral({ crew: 1_000, train: 40, atmos: 40 });
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot(general),
            state: makeState(),
            schedule,
            map,
            collectLogs: true,
        });
        const turns = harness.reservedTurnStore.getGeneralTurns(1);
        for (let idx = 0; idx < 4; idx += 1) {
            turns[idx] = { action: 'che_전투태세', args: {} };
        }

        for (let idx = 0; idx < 4; idx += 1) {
            await harness.runOneTick();
        }

        const updated = harness.world.getGeneralById(1)!;
        expect(updated.lastTurn).toEqual({ command: '전투태세', term: 1 });
        expect(updated.experience).toBe(0);
        expect(updated.train).toBe(40);
        expect(updated.atmos).toBe(40);
    });

    it('skips commands for blocked generals while advancing the queue once', async () => {
        const general = makeGeneral({ injury: 20, meta: { killturn: 5, block: 3 } });
        const harness = await createTurnTestHarness({
            snapshot: makeSnapshot(general),
            state: makeState(),
            schedule,
            map,
            collectLogs: true,
        });
        harness.reservedTurnStore.getGeneralTurns(1)[0] = { action: 'che_요양', args: {} };
        await harness.runOneTick();

        const updated = harness.world.getGeneralById(1)!;
        expect(updated.injury).toBe(10);
        expect(updated.experience).toBe(0);
        expect(updated.meta.killturn).toBe(4);
        // Ref InheritancePointManager ignores every source when the general
        // has no owner, including the per-turn lived_month source.
        expect(updated.meta.inherit_lived_month).toBeUndefined();
        expect(updated.meta.myset).toBe(3);
        expect(harness.reservedTurnStore.getGeneralTurn(1, 0).action).toBe('휴식');
        expect(harness.getCollectedLogs().some((log) => log.text.includes('악성유저'))).toBe(true);
    });

    it('deletes the troop row and releases members when a troop leader resigns', async () => {
        const leader = makeGeneral({ troopId: 1 });
        const member = makeGeneral({
            id: 2,
            name: '부대원',
            troopId: 1,
            turnTime: new Date(start.getTime() + 10 * 60_000),
        });
        const snapshot = makeSnapshot(leader, {
            generals: [member],
            troops: [{ id: 1, nationId: 1, name: '테스트군' }],
        });
        snapshot.nations[0]!.meta.gennum = 2;
        const harness = await createTurnTestHarness({
            snapshot,
            state: makeState(),
            schedule,
            map,
        });
        harness.reservedTurnStore.getGeneralTurns(1)[0] = { action: 'che_하야', args: {} };

        await harness.runOneTick({ maxGenerals: 1 });

        expect(harness.world.getGeneralById(1)?.troopId).toBe(0);
        expect(harness.world.getGeneralById(2)?.troopId).toBe(0);
        expect(harness.world.getTroopById(1)).toBeNull();
        expect(harness.world.consumeDirtyState().deletedTroops).toEqual([1]);
    });
});
