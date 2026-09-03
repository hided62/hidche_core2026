import { describe, expect, it, vi } from 'vitest';
import type { City, MapDefinition, Nation } from '@sammo-ts/logic';

import { composeCalendarHandlers } from '../src/turn/calendarHandlers.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createMonthlyEventHandler, type MonthlyEventActionHandler } from '../src/turn/monthlyEventHandler.js';
import { createMergeInheritPointRankHandler } from '../src/turn/monthlyUniqueInheritAction.js';
import { createUnificationHandler } from '../src/turn/unificationHandler.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const map: MapDefinition = {
    id: 'united-test',
    name: 'united-test',
    cities: [],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const general: TurnGeneral = {
    id: 1,
    userId: 'user-1',
    name: '통일장수',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    turnTime: new Date('0190-07-01T00:00:00.000Z'),
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    inheritancePoints: { previous: 100, unifier: 7, tournament: 11 },
    meta: {
        killturn: 24,
        inherit_lived_month: 10,
        max_belong: 4,
        max_domestic_critical: 20,
        inherit_active_action: 3,
        rank_warnum: 4,
        firenum: 2,
        dex1: 100,
        betwin: 2,
        betgold: 1000,
        betwingold: 500,
        inherit_earned_act: 5,
        inherit_spent_dyn: 50,
    },
    officerLevel: 12,
    experience: 10,
    dedication: 5,
    injury: 0,
    gold: 100,
    rice: 100,
    crew: 100,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 40,
    npcState: 0,
    picture: '1.png',
    imageServer: 0,
};

const nation: Nation = {
    id: 1,
    name: '통일국',
    color: '#ffffff',
    capitalCityId: 1,
    chiefGeneralId: 1,
    gold: 1000,
    rice: 2000,
    power: 3000,
    level: 4,
    typeCode: 'test',
    meta: {},
};

const city: City = {
    id: 1,
    name: '통일도시',
    nationId: 1,
    level: 4,
    state: 0,
    population: 1000,
    populationMax: 2000,
    agriculture: 0,
    agricultureMax: 0,
    commerce: 0,
    commerceMax: 0,
    security: 0,
    securityMax: 0,
    supplyState: 1,
    frontState: 0,
    defence: 0,
    defenceMax: 0,
    wall: 0,
    wallMax: 0,
    meta: {},
};

describe('unification handler', () => {
    it('refunds pending unique bids and runs UNITED before setting the united flag', async () => {
        const observed: Array<{ isUnited: unknown; unifier: number; previous: number; spent: unknown }> = [];
        const actions = new Map<string, MonthlyEventActionHandler>();
        let world: InMemoryTurnWorld | null = null;
        actions.set('MergeInheritPointRank', createMergeInheritPointRankHandler({ getWorld: () => world }));
        actions.set('ObserveUnited', () => {
            const current = world!.getGeneralById(1)!;
            observed.push({
                isUnited: world!.getState().meta.isUnited,
                unifier: current.inheritancePoints?.unifier ?? 0,
                previous: current.inheritancePoints?.previous ?? 0,
                spent: current.meta.inherit_spent_dyn,
            });
        });
        const events = createMonthlyEventHandler({ getWorld: () => world, startYear: 190, actions });
        const auctionCancellation = {
            auctionId: 77,
            status: 'OPEN' as const,
            closeAt: new Date('0190-08-01T00:00:00.000Z'),
            title: '보물 경매',
            highestBidId: 5,
            bidderGeneralId: 1,
            amount: 30,
            rankTrackedAmount: 30,
        };
        const legacyAuctionCancellation = {
            auctionId: 78,
            status: 'FINALIZING' as const,
            closeAt: new Date('0190-08-02T00:00:00.000Z'),
            title: '기존 보물 경매',
            highestBidId: 6,
            bidderGeneralId: 1,
            amount: 20,
            rankTrackedAmount: 0,
        };
        const unification = createUnificationHandler({
            profileName: 'che',
            getWorld: () => world,
            loadPendingUniqueAuctions: async () => [auctionCancellation, legacyAuctionCancellation],
            dispatchUnitedEvents: (context) => events.dispatchTarget('UNITED', context),
        });
        const state: TurnWorldState = {
            id: 1,
            currentYear: 190,
            currentMonth: 6,
            tickSeconds: 600,
            lastTurnTime: new Date('0190-06-01T00:00:00.000Z'),
            clockMode: 'realtime',
            clockPhase: 'RUNNING',
            meta: { serverId: 'server-1', refreshLimit: 2 },
        };
        const snapshot: TurnWorldSnapshot = {
            generals: [general],
            cities: [city],
            nations: [nation],
            troops: [],
            diplomacy: [],
            events: [
                {
                    id: 10,
                    targetCode: 'united',
                    priority: 5000,
                    condition: true,
                    action: [['ObserveUnited'], ['MergeInheritPointRank']],
                    meta: {},
                },
            ],
            initialEvents: [],
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: map.id, unitSet: 'test' },
            },
            scenarioMeta: {
                title: 'united test',
                startYear: 190,
                life: null,
                fiction: null,
                history: [],
                ignoreDefaultEvents: false,
            },
            map,
        };
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: composeCalendarHandlers(events, unification.handler),
        });

        await world.advanceMonth(new Date('0190-07-01T00:00:00.000Z'));

        expect(observed).toEqual([{ isUnited: undefined, unifier: 2007, previous: 150, spent: 20 }]);
        expect(world.getState().meta).toMatchObject({
            isUnited: 2,
            isunited: 2,
            refreshLimit: 200,
            dynastyStatistics: {
                maxNationCount: 1,
                maxGeneralCount: 1,
                currentGeneralCount: 1,
            },
        });
        expect(world.getGameClockState().phase).toBe('SUSPENDED');
        expect(world.getState().meta.unificationClockSuspensionId).toMatch(/^unification-wait-[a-f0-9]{32}$/);
        expect(world.getGeneralById(1)).toMatchObject({
            inheritancePoints: { previous: 150, unifier: 2007, tournament: 11 },
            meta: { inherit_earned_dyn: 2162.1, inherit_earned: 2167.1, inherit_spent: 20 },
        });
        expect(world.listEvents('united')).toHaveLength(1);
        expect(world.peekDirtyState().pendingUnificationFinalizations).toEqual([
            expect.objectContaining({ auctionCancellations: [auctionCancellation, legacyAuctionCancellation] }),
        ]);
        expect(
            world.peekDirtyState().messages.map((message) => ({
                text: message.text,
                action: message.option?.action,
                args: message.option?.args,
                recipient: message.dest.generalId,
            }))
        ).toEqual([
            {
                text: '이벤트 게임으로 이민족[어려움]을 소환',
                action: 'raiseInvader',
                args: [-2, -1.2, 15_000, -1],
                recipient: 1,
            },
            {
                text: '이벤트 게임으로 이민족[보통]을 소환',
                action: 'raiseInvader',
                args: [-2, -1.2, -1, -0.5],
                recipient: 1,
            },
            {
                text: '이벤트 게임으로 이민족[쉬움]을 소환',
                action: 'raiseInvader',
                args: [-1, -1, -0.8, 0],
                recipient: 1,
            },
        ]);

        const bid = vi.fn();
        const commands = createTurnDaemonCommandHandler({
            world,
            auctionBidder: { bid },
        });
        await expect(
            commands.handle({ type: 'auctionBid', userId: 'user-1', auctionId: 77, generalId: 1, amount: 100 })
        ).resolves.toMatchObject({ ok: false, reason: '천하통일 후에는 경매를 이용할 수 없습니다.' });
        await expect(
            commands.handle({
                type: 'auctionOpen',
                userId: 'user-1',
                auctionType: 'UNIQUE_ITEM',
                generalId: 1,
                amount: 100,
            })
        ).resolves.toMatchObject({ ok: false, reason: '천하통일 후에는 경매를 이용할 수 없습니다.' });
        expect(bid).not.toHaveBeenCalled();
    });
});
