import { describe, expect, it } from 'vitest';

import { createNeutralAuctionRegistrar } from '../src/auction/neutralRegistrar.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildGeneral = (id: number, npcState: number, gold: number, rice: number): TurnGeneral => ({
    id,
    name: `General_${id}`,
    nationId: 1,
    cityId: 0,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    turnTime: new Date('0180-01-01T00:00:00Z'),
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    officerLevel: 1,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold,
    rice,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState,
});

const buildSnapshot = (): TurnWorldSnapshot => ({
    generals: [
        buildGeneral(1, 0, 5_432, 7_654),
        // ref의 WHERE npc < 2와 같이 평균에서 제외되어야 한다.
        buildGeneral(2, 2, 99_999, 99_999),
    ],
    cities: [],
    // Core persists a synthetic id=0 row that Ref's nation-power loop never
    // sees. The registrar fallback must therefore still consume three rolls.
    nations: [0, 1, 2, 3].map((id) => ({
        id,
        name: `Nation_${id}`,
        color: '#000000',
        capitalCityId: null,
        chiefGeneralId: id === 1 ? 1 : 0,
        gold: 0,
        rice: 0,
        power: 0,
        level: 1,
        typeCode: 'che_def',
        meta: {},
    })),
    troops: [],
    diplomacy: [],
    events: [],
    initialEvents: [],
    map: {
        id: 'test',
        name: 'test',
        cities: [],
        defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
    },
    scenarioConfig: {
        stat: {
            total: 300,
            min: 10,
            max: 100,
            npcTotal: 150,
            npcMax: 50,
            npcMin: 10,
            chiefMin: 70,
        },
        iconPath: '',
        map: {},
        const: {},
        environment: { mapName: 'test', unitSet: 'default' },
    },
});

describe('neutral auction monthly registrar', () => {
    it('uses the previous month seed and queues the legacy amount at the new month boundary', async () => {
        const worldRef: { current: InMemoryTurnWorld | null } = { current: null };
        const now = new Date('2026-07-25T12:00:00.000Z');
        const registrar = await createNeutralAuctionRegistrar({
            databaseUrl: 'unused://test',
            profileName: 'test',
            getWorld: () => worldRef.current,
            getRedisClient: () => null,
            getWorldConfig: () => ({ tournamentTrig: false }),
            now: () => now,
            loadNeutralAuctionCounts: async () => [],
        });
        const state: TurnWorldState = {
            id: 1,
            currentYear: 180,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-07-25T00:00:00.000Z'),
            meta: { hiddenSeed: 'merchant-11', killturn: 24 },
        };
        const world = new InMemoryTurnWorld(state, buildSnapshot(), {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: registrar.handler,
        });
        worldRef.current = world;

        await world.advanceMonth(new Date('2026-07-25T00:10:00.000Z'));

        expect(world.getState()).toMatchObject({
            currentYear: 180,
            currentMonth: 2,
            meta: { neutralAuctionRegistrationKey: '180-02' },
        });
        expect(world.peekDirtyState().pendingNeutralAuctions).toEqual([
            expect.objectContaining({
                registrationKey: '180-02',
                type: 'BUY_RICE',
                targetCode: '1150',
                hostGeneralId: 0,
                hostName: '상인',
                closeAt: new Date(now.getTime() + 4 * 10 * 60_000),
                detail: expect.objectContaining({
                    amount: 1_150,
                    startBidAmount: 920,
                    finishBidAmount: 2_300,
                    seedYear: 180,
                    seedMonth: 1,
                    closeTurnCnt: 4,
                }),
            }),
        ]);
        await registrar.close();
    });

    it('continues after the legacy tournament roll and matches the tail-order fixture', async () => {
        const worldRef: { current: InMemoryTurnWorld | null } = { current: null };
        const now = new Date('2026-07-25T12:00:00.000Z');
        const registrar = await createNeutralAuctionRegistrar({
            databaseUrl: 'unused://test',
            profileName: 'test',
            getWorld: () => worldRef.current,
            getRedisClient: () => null,
            getWorldConfig: () => ({ tournamentTrig: true }),
            getNationPowerRollCount: () => 2,
            getTournamentRollConsumed: () => true,
            now: () => now,
            loadNeutralAuctionCounts: async () => [],
        });
        const snapshot = buildSnapshot();
        snapshot.nations = snapshot.nations.slice(1, 3);
        snapshot.generals = [buildGeneral(1, 0, 5_000, 7_000), buildGeneral(2, 0, 6_000, 8_000)];
        const state: TurnWorldState = {
            id: 1,
            currentYear: 193,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-07-25T00:00:00.000Z'),
            meta: { hiddenSeed: 'monthly-post-tail-2' },
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: registrar.handler,
        });
        worldRef.current = world;

        await world.advanceMonth(new Date('2026-07-25T00:10:00.000Z'));

        expect(world.peekDirtyState().pendingNeutralAuctions).toEqual([
            expect.objectContaining({
                type: 'BUY_RICE',
                targetCode: '380',
                detail: expect.objectContaining({
                    amount: 380,
                    startBidAmount: 300,
                    finishBidAmount: 750,
                }),
            }),
            expect.objectContaining({
                type: 'SELL_RICE',
                targetCode: '830',
                detail: expect.objectContaining({
                    amount: 830,
                    startBidAmount: 990,
                    finishBidAmount: 1_650,
                }),
            }),
        ]);
        await registrar.close();
    });
});
