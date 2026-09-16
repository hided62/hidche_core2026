import { describe, expect, it } from 'vitest';
import type { City, Nation } from '@sammo-ts/logic';
import { InMemoryTurnWorld, type GeneralTurnHandler } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import {
    createPlayAuditHandler,
    initializeAuditCollection,
    queueAuditMonth,
    recordAuditSettlement,
} from '../src/playAudit/collection.js';
const turnTime = new Date('0200-01-01T00:00:00.000Z');

const buildGeneral = (id: number, nationId: number): TurnGeneral => ({
    id,
    name: `장수${id}`,
    nationId,
    cityId: nationId,
    troopId: 0,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    experience: 1_000,
    dedication: 900,
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
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: nationId === 0 ? 2 : 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    turnTime,
});

const buildCity = (id: number, nationId: number): City => ({
    id,
    name: `도시${id}`,
    nationId,
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
    supplyState: 1,
    frontState: 0,
    defence: 1_000,
    defenceMax: 2_000,
    wall: 1_000,
    wallMax: 2_000,
    meta: {},
});

const buildNation = (id: number, power: number, meta: Nation['meta']): Nation => ({
    id,
    name: id === 0 ? '재야' : `국가${id}`,
    color: '#777777',
    capitalCityId: id === 0 ? null : id,
    chiefGeneralId: null,
    gold: 10_000,
    rice: 20_000,
    power,
    level: id === 0 ? 0 : 1,
    typeCode: 'che_중립',
    meta,
});

const buildWorld = (generalTurnHandler?: GeneralTurnHandler) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 200,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: turnTime,
        meta: { serverId: 'yearbook-projection-test' },
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'test' },
        },
        scenarioMeta: {
            title: '연감 테스트',
            startYear: 200,
            life: null,
            fiction: 0,
            history: [],
            ignoreDefaultEvents: false,
        },
        map: { id: 'test', name: 'test', cities: [] },
        nations: [
            {
                ...buildNation(0, 90, { gennum: 90, tech: 90 }),
                name: '오염된 재야',
                color: '#ffffff',
                level: 9,
            },
            buildNation(1, 777, { gennum: 9, tech: 100 }),
            buildNation(2, 0, { tech: 100 }),
        ],
        cities: [buildCity(0, 0), buildCity(1, 1), buildCity(2, 2)],
        generals: [buildGeneral(1, 0), buildGeneral(2, 0), buildGeneral(3, 1), buildGeneral(4, 2), buildGeneral(5, 2)],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
    };
    const world = new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        generalTurnHandler,
    });

    return world;
};
describe('play audit collection durability state', () => {
    it('preserves consecutive diplomacy transitions in one turn and restores them with the checkpoint', () => {
        const world = buildWorld({
            execute: ({ general }) => ({
                diplomacyPatches: [1, 0].map((state, index) => ({
                    srcNationId: 1,
                    destNationId: 2,
                    patch: { state, term: 6 },
                    audit: {
                        actionKey: index === 0 ? 'che_선전포고' : 'che_급습',
                        kind: 'nation',
                        actionOrdinal: index + 1,
                        actor: {
                            generalId: general.id,
                            userId: null,
                            name: general.name,
                            nationId: 1,
                            officerLevel: 12,
                            npcState: 2,
                        },
                    },
                })),
            }),
        });
        const checkpoint = world.captureState();
        const general = world.getGeneralById(3)!;
        world.executeGeneralTurn(general);
        const events = world.peekDirtyState().pendingAuditDiplomacy;
        expect(events).toHaveLength(2);
        expect(events.map((event) => [event.before?.state, event.after?.state])).toEqual([
            [2, 1],
            [1, 0],
        ]);
        expect(events.map((event) => event.ordinal)).toEqual([1, 2]);
        expect(new Set(events.map((event) => event.executionId)).size).toBe(1);
        expect(events.map((event) => event.actor?.actionKey)).toEqual(['che_선전포고', 'che_급습']);
        world.restoreState(checkpoint);
        expect(world.peekDirtyState().pendingAuditDiplomacy).toEqual([]);
        world.executeGeneralTurn(world.getGeneralById(3)!);
        expect(world.peekDirtyState().pendingAuditDiplomacy).toEqual(events);
    });

    it('freezes the initial observation separately from month-end and restores its marker on rollback', () => {
        const world = buildWorld();
        const before = world.captureState();
        const observedAt = new Date('2026-09-16T00:00:00.000Z');
        expect(initializeAuditCollection(world, observedAt)).toBe(true);
        expect(world.peekDirtyState().pendingAuditMonths).toMatchObject([
            { kind: 'INITIAL', year: 200, month: 1, settlementsComplete: false },
        ]);
        const marker = world.getState().meta.playAuditCollection;
        expect(initializeAuditCollection(world, new Date(observedAt.getTime() + 1000))).toBe(false);
        expect(world.getState().meta.playAuditCollection).toEqual(marker);
        expect(world.peekDirtyState().pendingAuditMonths).toHaveLength(1);
        const reloaded = buildWorld();
        reloaded.restoreState(world.captureState());
        expect(initializeAuditCollection(reloaded)).toBe(false);
        world.restoreState(before);
        expect(world.hasPendingAuditRecords()).toBe(false);
        expect(world.getState().meta.playAuditCollection).toBeUndefined();
        expect(initializeAuditCollection(world, observedAt)).toBe(true);
        queueAuditMonth(world);
        expect(world.peekDirtyState().pendingAuditMonths.map((sample) => sample.kind)).toEqual([
            'INITIAL',
            'MONTH_END',
        ]);
    });
    it('restores pending snapshots and monthly flows on rollback and acknowledges only persisted rows', () => {
        const world = buildWorld();
        const before = world.captureState();
        recordAuditSettlement(world, { nationId: 1, resource: 'gold', income: 943.5, paid: 123 });
        queueAuditMonth(world);
        expect(world.peekDirtyState().pendingAuditMonths).toHaveLength(1);
        world.restoreState(before);
        expect(world.peekDirtyState().pendingAuditMonths).toHaveLength(0);
        expect(world.getState().meta.playAuditFlows).toBeUndefined();
        queueAuditMonth(world);
        const saved = world.peekDirtyState();
        queueAuditMonth(world, 'FINAL');
        world.acknowledgeDirtyState(saved);
        expect(world.peekDirtyState().pendingAuditMonths.map((row) => row.kind)).toEqual(['FINAL']);
    });
    it('keeps partial adoption unknown then attributes income to the new month across reload state', async () => {
        const world = buildWorld();
        const handler = createPlayAuditHandler(() => world);
        await handler.beforeMonthChanged!({
            previousYear: 200,
            previousMonth: 1,
            currentYear: 200,
            currentMonth: 2,
            turnTime,
        });
        expect(world.peekDirtyState().pendingAuditMonths[0]!.settlementsComplete).toBe(false);
        const next = world.captureState();
        next.state.currentMonth = 2;
        world.restoreState(next);
        recordAuditSettlement(world, { nationId: 1, resource: 'gold', income: 943.5, paid: 123 });
        const reloaded = buildWorld();
        reloaded.restoreState(world.captureState());
        queueAuditMonth(reloaded);
        const feb = reloaded.peekDirtyState().pendingAuditMonths.at(-1)!;
        expect(feb.month).toBe(2);
        expect(feb.settlementsComplete).toBe(true);
        expect(feb.nations.find((row) => row.id === 1)).toMatchObject({
            incomeGold: 943.5,
            paidGold: 123,
            incomeRice: 0,
        });
    });
    it('does not replace missing season identity with a profile or create a false snapshot', () => {
        const world = buildWorld();
        const state = world.captureState();
        delete state.state.meta.serverId;
        world.restoreState(state);
        queueAuditMonth(world);
        expect(world.peekDirtyState().pendingAuditMonths).toEqual([]);
    });
});
