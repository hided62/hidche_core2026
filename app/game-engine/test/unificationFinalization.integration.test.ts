import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GAME_TICKS_PER_TURN, GameClock, normalizeArchivedGeneral, type ArchivedJsonValue } from '@sammo-ts/common';
import { createGamePostgresConnector, createRedisConnector, type GamePrismaClient } from '@sammo-ts/infra';
import { LogCategory, LogScope } from '@sammo-ts/logic';

import { createAuctionBidder } from '../src/auction/bidder.js';
import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { composeCalendarHandlers } from '../src/turn/calendarHandlers.js';
import { EngineStateManager } from '../src/turn/engineStateManager.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createMonthlyEventHandler, type MonthlyEventActionHandler } from '../src/turn/monthlyEventHandler.js';
import { createMergeInheritPointRankHandler } from '../src/turn/monthlyUniqueInheritAction.js';
import { loadPendingUnificationAuctionCancellations } from '../src/turn/unificationAuctionCancellation.js';
import { createUnificationHandler } from '../src/turn/unificationHandler.js';
import { loadTurnWorldFromDatabase } from '../src/turn/worldLoader.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';
import { reconcileClockSuspensionInTransaction } from '../src/turn/clockReconciliation.js';
import { applyNextClockProjection } from '../src/turn/clockProjectionOutbox.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const fixtureId = 8_901;
const serverId = 'che_unification_atomicity_fixture';
const profileName = 'che';
const userId = 'unification-atomicity-user';
const legacyOfficerPicture = 'users/core/a369f064a434262b025bd2ebc70c60d5.jpg?=20260814';
const invaderCityId = fixtureId + 1;
const invaderNationId = fixtureId + 1;
const invaderGeneralIds = Array.from({ length: 10 }, (_, index) => fixtureId + 1 + index);

integration('unification finalization transaction', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const cleanup = async (): Promise<void> => {
        await db.clockProjectionOutbox.deleteMany({
            where: { suspension: { worldState: { scenarioCode: 'unification-atomicity-fixture' } } },
        });
        await db.clockSuspension.deleteMany({
            where: { worldState: { scenarioCode: 'unification-atomicity-fixture' } },
        });
        await db.inputEvent.deleteMany({ where: { requestId: { startsWith: 'unification-clock:' } } });
        await db.turnDaemonLease.deleteMany({ where: { profile: profileName } });
        await db.message.deleteMany({ where: { mailbox: fixtureId } });
        await db.auction.deleteMany({ where: { hostGeneralId: fixtureId } });
        await db.event.deleteMany({ where: { id: { in: [fixtureId, fixtureId + 1, fixtureId + 2] } } });
        await db.unificationFinalization.deleteMany({ where: { serverId } });
        await db.yearbookHistory.deleteMany({ where: { profileName: serverId } });
        await db.emperor.deleteMany({ where: { serverId } });
        await db.oldGeneral.deleteMany({ where: { serverId } });
        await db.oldNation.deleteMany({ where: { serverId } });
        await db.hallOfFame.deleteMany({ where: { serverId } });
        await db.inheritanceResult.deleteMany({ where: { serverId } });
        await db.inheritanceLog.deleteMany({ where: { userId } });
        await db.inheritancePoint.deleteMany({ where: { userId } });
        await db.gameHistory.deleteMany({ where: { serverId } });
        await db.logEntry.deleteMany({
            where: { OR: [{ generalId: fixtureId }, { year: 190, month: 7 }] },
        });
        await db.generalTurn.deleteMany({ where: { generalId: { in: invaderGeneralIds } } });
        await db.nationTurn.deleteMany({ where: { nationId: invaderNationId } });
        await db.diplomacy.deleteMany({
            where: { OR: [{ srcNationId: invaderNationId }, { destNationId: invaderNationId }] },
        });
        await db.rankData.deleteMany({ where: { generalId: { in: [fixtureId, ...invaderGeneralIds] } } });
        await db.general.deleteMany({ where: { id: { in: [fixtureId, ...invaderGeneralIds] } } });
        await db.city.deleteMany({ where: { id: { in: [fixtureId, invaderCityId] } } });
        await db.nation.deleteMany({ where: { id: { in: [fixtureId, invaderNationId] } } });
        await db.worldState.deleteMany({ where: { scenarioCode: 'unification-atomicity-fixture' } });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await cleanup();
    });

    afterAll(async () => {
        await cleanup();
        await closeDb?.();
    });

    it('rolls every archive back on a late failure and applies it exactly once on retry', async () => {
        await db.nation.create({
            data: {
                id: fixtureId,
                name: '원자통일국',
                color: '#ffffff',
                capitalCityId: fixtureId,
                chiefGeneralId: fixtureId,
                gold: 1_000,
                rice: 2_000,
                tech: 123,
                level: 1,
                typeCode: 'che_중립',
                meta: {
                    power: 3_000,
                    max_power: { maxPower: 3_500, maxCrew: 400, maxCities: ['원자도시'] },
                    notice: '통일 공지',
                    infoText: '통일 임관 안내',
                },
            },
        });
        await db.city.create({
            data: {
                id: fixtureId,
                name: '원자도시',
                nationId: fixtureId,
                level: 3,
                population: 1_000,
                populationMax: 2_000,
                agriculture: 100,
                agricultureMax: 200,
                commerce: 100,
                commerceMax: 200,
                security: 100,
                securityMax: 200,
                defence: 100,
                defenceMax: 200,
                wall: 100,
                wallMax: 200,
                supplyState: 1,
                frontState: 0,
                region: 1,
                meta: { state: 0 },
            },
        });
        await db.city.create({
            data: {
                id: invaderCityId,
                name: '남만',
                nationId: fixtureId,
                level: 4,
                population: 1_000,
                populationMax: 2_000,
                agriculture: 100,
                agricultureMax: 200,
                commerce: 100,
                commerceMax: 200,
                security: 100,
                securityMax: 200,
                defence: 100,
                defenceMax: 200,
                wall: 100,
                wallMax: 200,
                supplyState: 1,
                frontState: 0,
                region: 1,
                meta: { state: 0 },
            },
        });
        await db.general.create({
            data: {
                id: fixtureId,
                userId,
                name: '원자장수',
                nationId: fixtureId,
                cityId: fixtureId,
                npcState: 0,
                officerLevel: 12,
                leadership: 80,
                strength: 70,
                intel: 60,
                experience: 10,
                dedication: 5,
                age: 40,
                crew: 400,
                picture: legacyOfficerPicture,
                turnTime: new Date('0190-07-01T00:00:00.000Z'),
                meta: {
                    ownerName: '원자 사용자',
                    killturn: 24,
                    inherit_lived_month: 10,
                    max_domestic_critical: 20,
                    inherit_active_action: 3,
                    rank_warnum: 4,
                    firenum: 2,
                    dex1: 100,
                    max_belong: 4,
                    betwin: 2,
                    betgold: 1_000,
                    betwingold: 500,
                    inherit_earned_act: 5,
                    inherit_spent_dyn: 30,
                },
            },
        });
        await db.rankData.createMany({
            data: [
                { generalId: fixtureId, nationId: fixtureId, type: 'warnum', value: 4 },
                { generalId: fixtureId, nationId: fixtureId, type: 'killnum', value: 3 },
                { generalId: fixtureId, nationId: fixtureId, type: 'deathnum', value: 1 },
                { generalId: fixtureId, nationId: fixtureId, type: 'firenum', value: 2 },
                { generalId: fixtureId, nationId: fixtureId, type: 'killcrew', value: 1_200 },
                { generalId: fixtureId, nationId: fixtureId, type: 'deathcrew', value: 800 },
            ],
        });
        await db.logEntry.createMany({
            data: [
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: fixtureId,
                    year: 190,
                    month: 6,
                    text: '보존하지 않을 개인 기록',
                },
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.BATTLE_DETAIL,
                    generalId: fixtureId,
                    year: 190,
                    month: 6,
                    text: '보존하지 않을 전투 기록',
                },
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.BATTLE_BRIEF,
                    generalId: fixtureId,
                    year: 190,
                    month: 5,
                    text: '먼저 보존할 전투 결과',
                },
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.BATTLE_BRIEF,
                    generalId: fixtureId,
                    year: 190,
                    month: 6,
                    text: '보존할 전투 결과',
                },
            ],
        });
        await db.inheritancePoint.createMany({
            data: [
                { userId, key: 'previous', value: 100 },
                { userId, key: 'tournament', value: 11 },
            ],
        });
        const futureCloseAt = new Date('0190-07-02T00:00:00.000Z');
        const uniqueAuction = await db.auction.create({
            data: {
                type: 'UNIQUE_ITEM',
                targetCode: 'che_서적_07_논어',
                hostGeneralId: fixtureId,
                hostName: '(상인)',
                detail: { title: '논어 경매', isReverse: false },
                status: 'OPEN',
                closeAt: futureCloseAt,
            },
        });
        const resourceAuction = await db.auction.create({
            data: {
                type: 'BUY_RICE',
                targetCode: '100',
                hostGeneralId: fixtureId,
                hostName: '원자장수',
                detail: { title: '쌀 구매 경매', amount: 100, isReverse: false },
                status: 'OPEN',
                closeAt: futureCloseAt,
            },
        });
        await db.event.create({
            data: {
                id: fixtureId,
                targetCode: 'united',
                priority: 5_000,
                condition: true,
                action: [['MergeInheritPointRank']],
                meta: { fixture: 'unification-atomicity' },
            },
        });
        const worldRow = await db.worldState.create({
            data: {
                scenarioCode: 'unification-atomicity-fixture',
                currentYear: 190,
                currentMonth: 6,
                tickSeconds: 600,
                config: {
                    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                    iconPath: '.',
                    map: {},
                    const: { minPushHallAge: 30 },
                    environment: { mapName: 'che', unitSet: 'che' },
                },
                meta: {
                    serverId,
                    serverName: '원자 서버',
                    season: 1,
                    scenarioId: 2,
                    refreshLimit: 2,
                    maxGeneralsPerMinute: 1,
                    lastGeneralId: fixtureId,
                    lastNationId: fixtureId,
                    scenarioMeta: {
                        title: '원자성 시나리오',
                        startYear: 190,
                        life: null,
                        fiction: null,
                        history: [],
                        ignoreDefaultEvents: false,
                    },
                },
            },
        });

        const beforeBid = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        const bidWorld = new InMemoryTurnWorld(beforeBid.state, beforeBid.snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        const bidProcessingTick = bidWorld.getGameClockState().tick;
        const futureCloseTick = BigInt(bidProcessingTick) + 86_400_000n;
        await db.auction.updateMany({
            where: { id: { in: [uniqueAuction.id, resourceAuction.id] } },
            data: { closeTick: futureCloseTick },
        });
        const bidder = await createAuctionBidder({ databaseUrl: databaseUrl!, world: bidWorld });
        const bidClockContext = {
            processingGameTick: bidProcessingTick,
            requestedAtWall: new Date('2026-09-03T00:00:00.000Z'),
        };
        try {
            await expect(
                bidder.bid({
                    type: 'auctionBid',
                    userId,
                    auctionId: uniqueAuction.id,
                    generalId: fixtureId,
                    amount: 30,
                    tryExtendCloseDate: false,
                    ...bidClockContext,
                } as Parameters<typeof bidder.bid>[0])
            ).resolves.toMatchObject({ ok: true, auctionId: uniqueAuction.id });
            await expect(
                bidder.bid({
                    type: 'auctionBid',
                    userId,
                    auctionId: uniqueAuction.id,
                    generalId: fixtureId,
                    amount: 50,
                    tryExtendCloseDate: false,
                    ...bidClockContext,
                } as Parameters<typeof bidder.bid>[0])
            ).resolves.toMatchObject({ ok: true, auctionId: uniqueAuction.id });
        } finally {
            await bidder.close();
        }
        expect(
            (await db.inheritancePoint.findUniqueOrThrow({ where: { userId_key: { userId, key: 'previous' } } })).value
        ).toBe(50);
        expect(
            await db.rankData.findUniqueOrThrow({
                where: { generalId_type: { generalId: fixtureId, type: 'inherit_spent_dyn' } },
            })
        ).toMatchObject({ value: 50 });
        const persistedBids = await db.auctionBid.findMany({
            where: { auctionId: uniqueAuction.id },
            orderBy: { id: 'asc' },
        });
        expect(persistedBids.map((bid) => bid.eventAt.toISOString())).toEqual([
            '0190-07-01T00:00:00.000Z',
            '0190-07-01T00:00:00.000Z',
        ]);
        expect(persistedBids.map((bid) => bid.meta)).toEqual([
            expect.objectContaining({ inheritSpentTrackedAmount: 30 }),
            expect.objectContaining({ inheritSpentTrackedAmount: 50 }),
        ]);

        const clockBaseTime = new Date('0190-01-01T00:00:00.000Z');
        const clockWallAnchor = new Date('2030-01-01T00:00:00.000Z');
        const fixtureClock = new GameClock({
            baseTime: clockBaseTime,
            tick: 0,
            mode: 'realtime',
            wallAnchor: clockWallAnchor,
            turnSeconds: 600,
            phase: 'RUNNING',
            revision: 1,
        });
        const initialClockTick = fixtureClock.dateToTick(new Date('0190-06-01T00:00:00.000Z'));
        await db.worldState.update({
            where: { id: worldRow.id },
            data: {
                clockBaseTime,
                clockTick: BigInt(initialClockTick),
                clockMode: 'realtime',
                clockWallAnchor,
                lastTurnTick: BigInt(initialClockTick),
                clockPhase: 'RUNNING',
                clockRevision: 1n,
                deadlineGeneration: 1n,
            },
        });
        await db.auction.updateMany({
            where: { id: { in: [uniqueAuction.id, resourceAuction.id] } },
            data: {
                openTick: BigInt(initialClockTick),
                closeTick: BigInt(fixtureClock.dateToTick(futureCloseAt)),
            },
        });
        const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        let world: InMemoryTurnWorld | null = null;
        const actions = new Map<string, MonthlyEventActionHandler>();
        actions.set('MergeInheritPointRank', createMergeInheritPointRankHandler({ getWorld: () => world }));
        const events = createMonthlyEventHandler({ getWorld: () => world, startYear: 190, actions });
        const unification = createUnificationHandler({
            profileName,
            getWorld: () => world,
            loadPendingUniqueAuctions: () => loadPendingUnificationAuctionCancellations(databaseUrl!),
            dispatchUnitedEvents: (context) => events.dispatchTarget('united', context),
        });
        world = new InMemoryTurnWorld(loaded.state, loaded.snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: composeCalendarHandlers(events, unification.handler),
        });
        const reservedTurns = new InMemoryReservedTurnStore(db, { maxGeneralTurns: 30, maxNationTurns: 12 });
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world, { profileName, reservedTurns });
        const stateManager = new EngineStateManager();
        stateManager.register('world', {
            capture: () => world!.captureState(),
            restore: (captured) => world!.restoreState(captured),
        });
        const runResult = {
            lastTurnTime: '0190-07-01T00:00:00.000Z',
            processedGenerals: 0,
            processedTurns: 1,
            durationMs: 0,
            partial: false,
        };
        try {
            const beforeFailedTurn = world.captureState();
            await expect(
                stateManager.transaction(async () => {
                    world!.advanceGameClockTo(new Date('0190-07-01T00:00:00.000Z'), clockWallAnchor);
                    await world!.advanceMonth(new Date('0190-07-01T00:00:00.000Z'));
                    expect(world!.getState().meta).toMatchObject({ isUnited: 2, isunited: 2, refreshLimit: 200 });
                    expect(world!.peekDirtyState().pendingUnificationFinalizations).toHaveLength(1);
                    expect(world!.peekDirtyState().pendingYearbookSnapshots).toHaveLength(1);
                    expect(world!.getGeneralById(fixtureId)).toMatchObject({
                        inheritancePoints: { previous: 100, unifier: 2_000, tournament: 11 },
                        meta: { inherit_earned_dyn: 2_155.1, inherit_earned: 2_160.1, inherit_spent: 0 },
                    });
                    await hooks.hooks.flushChanges?.(runResult);
                })
            ).rejects.toThrow();
            expect(world.captureState()).toEqual(beforeFailedTurn);

            expect(await db.unificationFinalization.count({ where: { serverId } })).toBe(0);
            expect(await db.yearbookHistory.count({ where: { profileName: serverId } })).toBe(0);
            expect(await db.inheritanceResult.count({ where: { serverId } })).toBe(0);
            expect(await db.oldGeneral.count({ where: { serverId } })).toBe(0);
            expect(await db.oldNation.count({ where: { serverId } })).toBe(0);
            expect(await db.emperor.count({ where: { serverId } })).toBe(0);
            expect(
                (await db.inheritancePoint.findUniqueOrThrow({ where: { userId_key: { userId, key: 'previous' } } }))
                    .value
            ).toBe(50);
            expect((await db.auction.findUniqueOrThrow({ where: { id: uniqueAuction.id } })).status).toBe('OPEN');
            expect((await db.auction.findUniqueOrThrow({ where: { id: resourceAuction.id } })).status).toBe('OPEN');
            expect(await db.message.count({ where: { mailbox: fixtureId } })).toBe(0);
            expect(world.peekDirtyState().pendingUnificationFinalizations).toHaveLength(0);

            await db.gameHistory.create({
                data: {
                    serverId,
                    date: new Date('0190-01-01T00:00:00.000Z'),
                    season: 1,
                    scenario: 2,
                    scenarioName: '원자성 시나리오',
                },
            });
            await stateManager.transaction(async () => {
                world!.advanceGameClockTo(new Date('0190-07-01T00:00:00.000Z'), clockWallAnchor);
                await world!.advanceMonth(new Date('0190-07-01T00:00:00.000Z'));
                await hooks.hooks.flushChanges?.(runResult);
            });

            expect(await db.unificationFinalization.count({ where: { serverId } })).toBe(1);
            expect(await db.inheritanceResult.count({ where: { serverId } })).toBe(1);
            expect(await db.oldGeneral.count({ where: { serverId } })).toBe(1);
            expect(await db.oldNation.count({ where: { serverId } })).toBe(2);
            expect(
                (
                    await db.oldNation.findUniqueOrThrow({
                        where: {
                            serverId_nation_sourceId: { serverId, nation: fixtureId, sourceId: 0 },
                        },
                    })
                ).data
            ).toMatchObject({
                nation: fixtureId,
                name: '원자통일국',
                type: 'che_중립',
                typeCode: 'che_중립',
                tech: 123,
                maxPower: 3_500,
                maxCrew: 400,
                maxCities: ['원자도시'],
                aux: { maxPower: 3_500, maxCrew: 400, maxCities: ['원자도시'] },
                generals: [fixtureId],
                msg: '통일 공지',
                scout_msg: '통일 임관 안내',
            });
            expect(legacyOfficerPicture.length).toBeGreaterThan(32);
            expect(await db.emperor.findFirstOrThrow({ where: { serverId } })).toMatchObject({
                l12pic: legacyOfficerPicture,
            });
            expect(
                (await db.inheritancePoint.findUniqueOrThrow({ where: { userId_key: { userId, key: 'previous' } } }))
                    .value
            ).toBe(2_255);
            expect(await db.inheritancePoint.count({ where: { userId, key: { not: 'previous' } } })).toBe(0);
            expect(await db.inheritanceResult.findFirstOrThrow({ where: { serverId } })).toMatchObject({
                value: expect.objectContaining({
                    previous: 100,
                    max_belong: 40,
                    tournament: 11,
                    betting: 5,
                    unifier: 2_000,
                    unifierBeforeAward: 0,
                    unifierAward: 2_000,
                    total: 2_255,
                }),
            });
            expect(await db.auction.findUniqueOrThrow({ where: { id: uniqueAuction.id } })).toMatchObject({
                status: 'CANCELED',
                finishedAt: new Date('0190-07-01T00:00:00.000Z'),
            });
            expect((await db.auction.findUniqueOrThrow({ where: { id: resourceAuction.id } })).status).toBe('OPEN');
            expect(await db.auctionBid.count({ where: { auctionId: uniqueAuction.id } })).toBe(2);
            const cancellationMessage = await db.message.findFirstOrThrow({ where: { mailbox: fixtureId } });
            expect(cancellationMessage).toMatchObject({
                mailbox: fixtureId,
                src: 0,
                dest: fixtureId,
                time: new Date('0190-07-01T00:00:00.000Z'),
            });
            expect(cancellationMessage.message).toMatchObject({
                text: `${uniqueAuction.id}번 논어 경매가 취소되었습니다.`,
            });
            expect(await db.event.count({ where: { id: fixtureId } })).toBe(1);
            expect(
                await db.rankData.findUniqueOrThrow({
                    where: { generalId_type: { generalId: fixtureId, type: 'inherit_spent' } },
                })
            ).toMatchObject({ value: 0 });
            await expect(
                db.rankData.findUniqueOrThrow({
                    where: { generalId_type: { generalId: fixtureId, type: 'inherit_spent_dyn' } },
                })
            ).resolves.toMatchObject({ value: 0 });
            await expect(
                db.rankData.findUniqueOrThrow({
                    where: { generalId_type: { generalId: fixtureId, type: 'inherit_earned_dyn' } },
                })
            ).resolves.toMatchObject({ value: 2_155 });
            await expect(
                db.rankData.findUniqueOrThrow({
                    where: { generalId_type: { generalId: fixtureId, type: 'inherit_earned' } },
                })
            ).resolves.toMatchObject({ value: 2_160 });
            const archivedGeneral = await db.oldGeneral.findUniqueOrThrow({
                where: { by_no: { serverId, generalNo: fixtureId } },
            });
            const archivedSnapshot = normalizeArchivedGeneral(
                archivedGeneral.data as ArchivedJsonValue,
                archivedGeneral.name
            ).snapshot;
            expect(archivedSnapshot).toMatchObject({
                mastery: { infantry: 100 },
                battle: {
                    battles: 4,
                    wins: 3,
                    losses: 1,
                    fireSuccesses: 2,
                    killedCrew: 1_200,
                    lostCrew: 800,
                },
                records: { battleResult: ['보존할 전투 결과', '먼저 보존할 전투 결과'] },
                availability: { battleResultLogs: true, battleDetailLogs: false },
            });
            expect(JSON.stringify(archivedGeneral.data)).not.toContain('보존하지 않을 개인 기록');
            expect(JSON.stringify(archivedGeneral.data)).not.toContain('보존하지 않을 전투 기록');
            expect((await db.gameHistory.findUniqueOrThrow({ where: { serverId } })).winnerNation).toBe(fixtureId);
            const yearbook = await db.yearbookHistory.findUniqueOrThrow({
                where: {
                    profileName_year_month_sourceId: {
                        profileName: serverId,
                        year: 190,
                        month: 7,
                        sourceId: 0,
                    },
                },
            });
            expect(yearbook.globalHistory).toEqual(expect.arrayContaining([expect.stringContaining('【통일】')]));
            expect(world.peekDirtyState().pendingUnificationFinalizations).toHaveLength(0);

            await hooks.hooks.flushChanges?.(runResult);
            expect(await db.unificationFinalization.count({ where: { serverId } })).toBe(1);
            expect(await db.inheritanceResult.count({ where: { serverId } })).toBe(1);
            expect(await db.emperor.count({ where: { serverId } })).toBe(1);
            expect(await db.worldState.findUniqueOrThrow({ where: { id: worldRow.id } })).toMatchObject({
                currentYear: 190,
                currentMonth: 7,
                clockPhase: 'SUSPENDED',
            });
            const suspension = await db.clockSuspension.findFirstOrThrow({ where: { worldStateId: worldRow.id } });
            expect(suspension).toMatchObject({
                source: 'UNIFICATION_WAIT',
                policy: 'EXACT',
                status: 'SUSPENDED',
                sourceRevision: 1n,
                targetRevision: 2n,
            });

            const invaderPrompt = (await db.message.findMany({ where: { mailbox: fixtureId } })).find((row) => {
                const payload = row.message as { option?: { action?: unknown } };
                return payload.option?.action === 'raiseInvader';
            });
            expect(invaderPrompt).toBeDefined();
            const requestId = 'unification-clock:raise-invader';
            await db.inputEvent.create({
                data: {
                    requestId,
                    target: 'ENGINE',
                    eventType: 'messageRespond',
                    actorUserId: userId,
                    payload: {
                        type: 'messageRespond',
                        requestId,
                        userId,
                        generalId: fixtureId,
                        messageId: invaderPrompt!.id,
                        response: true,
                    },
                    status: 'PROCESSING',
                    acceptedGameTick: suspension.cutTick,
                    acceptedClockRevision: suspension.sourceRevision,
                    acceptedDeadlineGeneration: 1n,
                    processingAt: new Date(),
                    processingGameTick: suspension.cutTick,
                    processingClockRevision: suspension.sourceRevision,
                    processingDeadlineGeneration: 999n,
                    lockedBy: 'unification-clock-fixture',
                    leaseUntil: new Date(Date.now() + 60_000),
                    attempts: 1,
                },
            });
            const resumeWallAt = new Date(suspension.cutWallAt.getTime() + 36 * 60 * 60_000);
            await db.turnDaemonLease.create({
                data: {
                    profile: profileName,
                    ownerId: 'unification-clock-fixture',
                    fencingEpoch: 1n,
                    leaseUntil: new Date(Date.now() + 60_000),
                },
            });
            const commandHandler = createTurnDaemonCommandHandler({
                world,
                reservedTurns,
                scenarioMeta: loaded.snapshot.scenarioMeta,
                map: loaded.snapshot.map,
                loadArchivedNationMaxId: async () => fixtureId,
                reconcileUnificationWait: (input) =>
                    reconcileClockSuspensionInTransaction({
                        ...input,
                        allowUnificationWait: true,
                        testResumeWallAt: resumeWallAt,
                    }),
            });
            const command = {
                type: 'messageRespond' as const,
                requestId,
                userId,
                generalId: fixtureId,
                messageId: invaderPrompt!.id,
                response: true,
            };
            const executeCommand = () =>
                hooks.hooks.executeCommand!(requestId, async (context) => {
                    const result = await commandHandler.handle(command, {
                        ...context,
                        clockOperationAuthority: {
                            kind: 'DAEMON',
                            profileName,
                            ownerId: 'unification-clock-fixture',
                            fencingEpoch: 1n,
                        },
                    });
                    if (!result) throw new Error('Fixture command was not handled.');
                    return result;
                });
            const beforeFailedInvader = world.captureState();
            await expect(stateManager.transaction(executeCommand)).rejects.toThrow(
                'Input event processing clock fence changed before commit'
            );
            expect(world.captureState()).toEqual(beforeFailedInvader);
            expect(await db.nation.count({ where: { id: invaderNationId } })).toBe(0);
            expect(await db.clockProjectionOutbox.count({ where: { suspensionId: suspension.id } })).toBe(0);
            expect(await db.clockSuspension.findUniqueOrThrow({ where: { id: suspension.id } })).toMatchObject({
                status: 'SUSPENDED',
                sourceRevision: 1n,
            });
            await db.inputEvent.update({
                where: { requestId },
                data: { processingDeadlineGeneration: 1n },
            });
            const commandResult = await stateManager.transaction(executeCommand);
            expect(commandResult).toMatchObject({ type: 'messageRespond', ok: true, action: 'raiseInvader' });
            const selectedPromptAction = await db.messageAction.findUniqueOrThrow({
                where: { messageId: invaderPrompt!.id },
            });
            const siblingPromptActions = await db.messageAction.findMany({
                where: {
                    actionType: 'raiseInvader',
                    createdGameTick: selectedPromptAction.createdGameTick,
                },
            });
            expect(siblingPromptActions.length).toBeGreaterThan(1);
            expect(
                siblingPromptActions.every(
                    (action) =>
                        action.status === 'RESOLVED' &&
                        action.resolvedGameTick !== null &&
                        action.resolvedGameTick >= action.createdGameTick
                )
            ).toBe(true);
            const reconciledWorld = await db.worldState.findUniqueOrThrow({ where: { id: worldRow.id } });
            const appliedSuspension = await db.clockSuspension.findUniqueOrThrow({ where: { id: suspension.id } });
            expect(reconciledWorld).toMatchObject({
                clockPhase: 'RECONCILING',
                clockRevision: 2n,
                deadlineGeneration: 2n,
                tickSeconds: 1_200,
                meta: expect.objectContaining({ isUnited: 1, isunited: 1 }),
            });
            expect(appliedSuspension).toMatchObject({
                status: 'RECONCILING',
                gapTicks: BigInt(36 * 60 * 60 * 60_000),
                shiftTicks: BigInt(36 * 60 * 60 * 60_000),
            });
            expect(await db.nation.findUniqueOrThrow({ where: { id: invaderNationId } })).toMatchObject({
                name: 'ⓞ남만족',
                capitalCityId: invaderCityId,
            });
            expect(await db.general.count({ where: { id: { in: invaderGeneralIds } } })).toBe(10);
            const invaderTurns = await db.general.findMany({
                where: { id: { in: invaderGeneralIds } },
                select: { turnTick: true },
                orderBy: { id: 'asc' },
            });
            expect(
                invaderTurns.every((entry) => entry.turnTick !== null && entry.turnTick > reconciledWorld.clockTick!)
            ).toBe(true);
            expect(
                invaderTurns.every(
                    (entry) =>
                        entry.turnTick !== null &&
                        entry.turnTick <= reconciledWorld.clockTick! + BigInt(GAME_TICKS_PER_TURN)
                )
            ).toBe(true);
            expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).toMatchObject({
                status: 'SUCCEEDED',
                processingClockRevision: 1n,
                processingDeadlineGeneration: 1n,
            });
            expect(
                await db.clockProjectionOutbox.findFirstOrThrow({ where: { suspensionId: suspension.id } })
            ).toMatchObject({ status: 'PENDING', targetRevision: 2n });

            if (process.env.REDIS_URL) {
                const redis = createRedisConnector({ url: process.env.REDIS_URL });
                await redis.connect();
                const prefix = `sammo:${profileName}`;
                try {
                    await redis.client.del([
                        `${prefix}:clock:active-revision`,
                        `${prefix}:clock:deadline-generation`,
                        `${prefix}:clock:projection-checksum`,
                        `${prefix}:clock:phase`,
                        `${prefix}:auction:timer`,
                        `${prefix}:tournament:state`,
                    ]);
                    await redis.client.set(`${prefix}:clock:active-revision`, '1');
                    await expect(
                        applyNextClockProjection({ db, redis: redis.client, workerId: 'unification-clock-fixture' })
                    ).resolves.toBe('APPLIED');
                    expect(await db.worldState.findUniqueOrThrow({ where: { id: worldRow.id } })).toMatchObject({
                        clockPhase: 'RUNNING',
                        clockRevision: 2n,
                        deadlineGeneration: 2n,
                    });
                    world.completeClockReconciliation();
                    expect(world.getGameClockState().phase).toBe('RUNNING');
                } finally {
                    await redis.client.del([
                        `${prefix}:clock:active-revision`,
                        `${prefix}:clock:deadline-generation`,
                        `${prefix}:clock:projection-checksum`,
                        `${prefix}:clock:phase`,
                        `${prefix}:auction:timer`,
                        `${prefix}:tournament:state`,
                    ]);
                    await redis.disconnect();
                }
            }
        } finally {
            await hooks.close();
        }
    });
});
