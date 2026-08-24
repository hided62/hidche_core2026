import { loadActionModuleBundle, type TurnCommandProfile, type TurnSchedule } from '@sammo-ts/logic';
import {
    buildGameEventChannel,
    buildGameReadModelDomainRevisionKey,
    buildGameReadModelRevisionKey,
    createEmptyRealtimeReadModelChanges,
    GameClock,
    hasRealtimeReadModelChanges,
    SystemClock,
    type GameClockMode,
    type RealtimeEvent,
    type RealtimeReadModelChanges,
} from '@sammo-ts/common';
import { createGamePostgresConnector, createRedisConnector, resolveRedisConfigFromEnv } from '@sammo-ts/infra';
import { NATION_TRAIT_KEYS, NationTraitLoader, loadNationTraitModules } from '@sammo-ts/logic';

import { getNextTickTime } from '../lifecycle/getNextTickTime.js';
import { InMemoryControlQueue } from '../lifecycle/inMemoryControlQueue.js';
import type { Clock, TurnDaemonControlQueue, TurnDaemonHooks, TurnRunBudget } from '../lifecycle/types.js';
import { TurnDaemonLifecycle } from '../lifecycle/turnDaemonLifecycle.js';
import { DatabaseTurnDaemonCommandQueue } from '../lifecycle/databaseCommandQueue.js';
import type { MapLoaderOptions } from '../scenario/mapLoader.js';
import { createDatabaseTurnHooks, type CommittedReadModelChangeReceipt } from './databaseHooks.js';
import type { GeneralTurnHandler, InMemoryTurnWorldOptions, TurnCalendarHandler } from './inMemoryWorld.js';
import { InMemoryTurnWorld } from './inMemoryWorld.js';
import { InMemoryTurnProcessor } from './inMemoryTurnProcessor.js';
import { InMemoryTurnStateStore } from './inMemoryStateStore.js';
import { createGatewayAdminActionConsumer } from './gatewayAdminActions.js';
import { createGatewayProfileGate } from './gatewayProfileGate.js';
import { composeCalendarHandlers } from './calendarHandlers.js';
import { createIncomeHandler } from './incomeHandler.js';
import { createNationTurnMonthlyHandler } from './nationTurnMonthlyHandler.js';
import { calculateNpcNationFinance } from './npcTaxHandler.js';
import { createMonthlyBoundaryPreHandler } from './monthlyBoundaryPreHandler.js';
import { createMonthlyWanderHandler } from './monthlyWanderHandler.js';
import {
    createMonthlyDiplomacyHandler,
    createMonthlyNationCountHandler,
    createMonthlyNationStatsHandler,
    createMonthlyWarSettingHandler,
} from './monthlyNationStatsHandler.js';
import { createFrontStateHandler } from './frontStateHandler.js';
import { createReservedTurnHandler } from './reservedTurnHandler.js';
import { createReservedTurnStore, type InMemoryReservedTurnStore } from './reservedTurnStore.js';
import { createTurnDaemonCommandHandler } from './worldCommandHandler.js';
import { loadTurnCommandProfile } from './turnCommandProfile.js';
import { loadTurnWorldFromDatabase } from './worldLoader.js';
import { shouldUseAi } from './ai/generalAi.js';
import { createUnificationHandler } from './unificationHandler.js';
import { loadPendingUnificationAuctionCancellations } from './unificationAuctionCancellation.js';
import { createAuctionFinalizer } from '../auction/finalizer.js';
import { createAuctionBidder } from '../auction/bidder.js';
import { createNeutralAuctionRegistrar } from '../auction/neutralRegistrar.js';
import { createTournamentRewardFinalizer } from '../tournament/finalizer.js';
import { createTournamentAutoStartHandler } from './tournamentAutoStart.js';
import { createDynastyStatisticsHandler, createYearbookHandler } from './yearbookHandler.js';
import {
    createMonthlyEventHandler,
    createRandomizeCityTradeRateHandler,
    type MonthlyEventActionHandler,
} from './monthlyEventHandler.js';
import { createRaiseDisasterHandler } from './monthlyDisasterAction.js';
import { createUpdateCitySupplyHandler } from './monthlyCitySupplyAction.js';
import { createUpdateNationLevelHandler } from './monthlyNationLevelAction.js';
import { createProcessSemiAnnualHandler } from './monthlySemiAnnualAction.js';
import { createProcessWarIncomeHandler } from './monthlyWarIncomeAction.js';
import { createCreateAdminNpcHandler } from './monthlyCreateAdminNpcAction.js';
import { createCreateManyNpcHandler } from './monthlyCreateManyNpcAction.js';
import { createRegisterNpcHandler } from './monthlyRegisterNpcAction.js';
import { createRaiseNpcNationHandler } from './monthlyRaiseNpcNationAction.js';
import {
    createAutoDeleteInvaderHandler,
    createInvaderEndingHandler,
    createRaiseInvaderHandler,
} from './monthlyInvaderAction.js';
import { createChangeCityHandler } from './monthlyChangeCityAction.js';
import { createProvideNpcTroopLeaderHandler } from './monthlyProvideNpcTroopLeaderAction.js';
import { createFinishNationBettingHandler, createOpenNationBettingHandler } from './monthlyNationBettingAction.js';
import { createScoutBlockHandler } from './monthlyScoutBlockAction.js';
import { createAddGlobalBetrayHandler, createAssignGeneralSpecialityHandler } from './monthlySpecialityBetrayAction.js';
import { createLostUniqueItemHandler, createMergeInheritPointRankHandler } from './monthlyUniqueInheritAction.js';
import { createAdvanceCentennialAllStarHandler } from './monthlyCentennialAllStarAction.js';
import {
    createNewYearHandler,
    createNoticeToHistoryLogHandler,
    createProcessIncomeActionHandler,
    createResetOfficerLockHandler,
} from './monthlyCoreEventAction.js';
import { buildCommandEnv } from './reservedTurnCommands.js';
import { DatabaseTurnDaemonLease, TurnDaemonLeaseUnavailableError } from '../lifecycle/databaseTurnDaemonLease.js';
import { EngineStateManager } from './engineStateManager.js';
import { applyRuntimeClockShift } from './runtimeClockShift.js';
import { applyRuntimeGameSettings } from './runtimeGameSettings.js';

export interface TurnDaemonRuntimeOptions {
    profile: string;
    profileName?: string;
    databaseUrl: string;
    gatewayDatabaseUrl?: string;
    defaultBudget?: TurnRunBudget;
    clock?: Clock;
    gameClockMode?: GameClockMode;
    controlQueue?: TurnDaemonControlQueue;
    schedule?: TurnSchedule;
    tickMinutes?: number;
    mapOptions?: MapLoaderOptions;
    generalTurnHandler?: GeneralTurnHandler;
    calendarHandler?: TurnCalendarHandler;
    enableDatabaseFlush?: boolean;
    pauseGateIntervalMs?: number;
    commandProfile?: TurnCommandProfile;
    commandProfilePath?: string;
    adminActionIntervalMs?: number;
    redisUrl?: string;
    commandStreamStartId?: string;
    leaseDurationMs?: number;
    leaseOwnerId?: string;
    enableLeaseHeartbeat?: boolean;
    /**
     * Isolated, single-process fixture acceleration only. Reserved turns are
     * loaded once and no concurrent API writer may touch this database.
     */
    exclusiveFastForward?: boolean;
    databaseTransactionTimeoutMs?: number;
    onActionResolved?: NonNullable<Parameters<typeof createReservedTurnHandler>[0]['onActionResolved']>;
}

export interface TurnDaemonRuntime {
    lifecycle: TurnDaemonLifecycle;
    world: InMemoryTurnWorld;
    controlQueue: TurnDaemonControlQueue;
    stateStore: InMemoryTurnStateStore;
    stateManager: EngineStateManager;
    processor: InMemoryTurnProcessor;
    reservedTurns: InMemoryReservedTurnStore | null;
    hooks?: TurnDaemonHooks;
    close(): Promise<void>;
}

const resolveTickMinutes = (tickSeconds: number, override?: number): number => {
    if (override !== undefined) {
        return Math.max(1, override);
    }
    return Math.max(1, Math.round(tickSeconds / 60));
};

const buildFixedSchedule = (tickMinutes: number): TurnSchedule => ({
    entries: [{ startMinute: 0, tickMinutes }],
});

const loadOccupiedAuctionUniqueCounts = async (databaseUrl: string): Promise<Map<string, number>> => {
    const connector = createGamePostgresConnector({ url: databaseUrl });
    await connector.connect();
    try {
        const rows = await connector.prisma.auction.findMany({
            where: {
                type: 'UNIQUE_ITEM',
                status: { in: ['OPEN', 'FINALIZING'] },
                targetCode: { not: null },
            },
            select: { targetCode: true },
        });
        const counts = new Map<string, number>();
        for (const row of rows) {
            if (row.targetCode) {
                counts.set(row.targetCode, (counts.get(row.targetCode) ?? 0) + 1);
            }
        }
        return counts;
    } finally {
        await connector.disconnect();
    }
};

const loadArchivedNationMaxId = async (databaseUrl: string, serverId: string): Promise<number> => {
    const connector = createGamePostgresConnector({ url: databaseUrl });
    await connector.connect();
    try {
        const row = await connector.prisma.oldNation.aggregate({
            where: { serverId },
            _max: { nation: true },
        });
        return row._max.nation ?? 0;
    } finally {
        await connector.disconnect();
    }
};

const resolveRedisConfig = (redisUrl?: string, env: NodeJS.ProcessEnv = process.env) => {
    if (redisUrl) {
        return { url: redisUrl };
    }
    if (!env.REDIS_URL) {
        return null;
    }
    return resolveRedisConfigFromEnv(env);
};

type LoadedTurnWorld = Awaited<ReturnType<typeof loadTurnWorldFromDatabase>>;
type MonthlyActionModuleBundle = Awaited<ReturnType<typeof loadActionModuleBundle>>;
type NationTraitModuleMap = Map<string, Awaited<ReturnType<typeof loadNationTraitModules>>[number]>;
type ReservedTurnStoreHandle = Awaited<ReturnType<typeof createReservedTurnStore>>;
type RedisConnector = ReturnType<typeof createRedisConnector>;
type GamePostgresConnector = ReturnType<typeof createGamePostgresConnector>;

const resolveRuntimeState = (
    state: LoadedTurnWorld['state'],
    options: Pick<TurnDaemonRuntimeOptions, 'tickMinutes' | 'gameClockMode'>,
    clock: Clock
) => {
    const tickMinutes = resolveTickMinutes(state.tickSeconds, options.tickMinutes);
    const nextTickSeconds = tickMinutes * 60;
    const tickSecondsChanged = options.tickMinutes !== undefined && nextTickSeconds !== state.tickSeconds;
    const clockBaseTime = tickSecondsChanged
        ? GameClock.baseTimeForProjection(
              new GameClock({
                  baseTime: state.clockBaseTime ?? state.lastTurnTime,
                  tick: state.clockTick ?? state.lastTurnTick ?? 0,
                  mode: state.clockMode ?? 'manual',
                  wallAnchor: state.clockWallAnchor ?? state.lastTurnTime,
                  turnSeconds: state.tickSeconds,
              }).tickToDate(state.clockTick ?? state.lastTurnTick ?? 0),
              state.clockTick ?? state.lastTurnTick ?? 0,
              nextTickSeconds
          )
        : state.clockBaseTime;
    const modeChanged = options.gameClockMode !== undefined && options.gameClockMode !== state.clockMode;
    const resolvedState = {
        ...state,
        ...(options.tickMinutes ? { tickSeconds: nextTickSeconds, clockBaseTime } : {}),
        ...(options.gameClockMode ? { clockMode: options.gameClockMode } : {}),
        ...(modeChanged ? { clockWallAnchor: new Date(clock.nowMs()) } : {}),
    };
    return { tickMinutes, resolvedState };
};

const hasMonthlyEventAction = (events: LoadedTurnWorld['snapshot']['events'], name: string): boolean =>
    events.some(
        (event) =>
            Array.isArray(event.action) && event.action.some((action) => Array.isArray(action) && action[0] === name)
    );

const requiresReservedTurnStore = (events: LoadedTurnWorld['snapshot']['events']): boolean =>
    [
        'UpdateNationLevel',
        'CreateManyNPC',
        'RegNPC',
        'RegNeutralNPC',
        'RaiseNPCNation',
        'RaiseInvader',
        'AutoDeleteInvader',
        'ProvideNPCTroopLeader',
    ].some((name) => hasMonthlyEventAction(events, name));

const createMonthlyEventActions = (options: {
    databaseUrl: string;
    snapshot: LoadedTurnWorld['snapshot'];
    getWorld: () => InMemoryTurnWorld | null;
    reservedTurnStoreHandle: ReservedTurnStoreHandle | null;
    commandEnv: ReturnType<typeof buildCommandEnv>;
    actionModules: MonthlyActionModuleBundle;
    nationTraits: NationTraitModuleMap;
    incomeHandler: ReturnType<typeof createIncomeHandler>;
}): Map<string, MonthlyEventActionHandler> => {
    const eventActions = new Map<string, MonthlyEventActionHandler>();
    eventActions.set(
        'RandomizeCityTradeRate',
        createRandomizeCityTradeRateHandler({
            getWorld: options.getWorld,
        })
    );
    eventActions.set(
        'RaiseDisaster',
        createRaiseDisasterHandler({
            getWorld: options.getWorld,
            generalActionModules: options.actionModules.general,
        })
    );
    eventActions.set(
        'UpdateCitySupply',
        createUpdateCitySupplyHandler({
            getWorld: options.getWorld,
            map: options.snapshot.map,
        })
    );
    eventActions.set(
        'ProcessSemiAnnual',
        createProcessSemiAnnualHandler({
            getWorld: options.getWorld,
            nationTraits: options.nationTraits,
        })
    );
    eventActions.set(
        'ProcessWarIncome',
        createProcessWarIncomeHandler({
            getWorld: options.getWorld,
            nationTraits: options.nationTraits,
        })
    );
    eventActions.set('CreateAdminNPC', createCreateAdminNpcHandler());
    if (options.reservedTurnStoreHandle) {
        const reservedTurns = options.reservedTurnStoreHandle.store;
        eventActions.set(
            'CreateManyNPC',
            createCreateManyNpcHandler({
                getWorld: options.getWorld,
                reservedTurns,
                env: options.commandEnv,
            })
        );
        for (const actionName of ['RegNPC', 'RegNeutralNPC'] as const) {
            eventActions.set(
                actionName,
                createRegisterNpcHandler({
                    actionName,
                    getWorld: options.getWorld,
                    reservedTurns,
                    env: options.commandEnv,
                    worldConfig: options.snapshot.worldConfig,
                    scenarioFiction: options.snapshot.scenarioMeta?.fiction,
                })
            );
        }
        eventActions.set(
            'RaiseNPCNation',
            createRaiseNpcNationHandler({
                getWorld: options.getWorld,
                reservedTurns,
                env: options.commandEnv,
                map: options.snapshot.map,
                loadArchivedNationMaxId: (serverId) => loadArchivedNationMaxId(options.databaseUrl, serverId),
            })
        );
        eventActions.set(
            'RaiseInvader',
            createRaiseInvaderHandler({
                getWorld: options.getWorld,
                reservedTurns,
                env: options.commandEnv,
                loadArchivedNationMaxId: (serverId) => loadArchivedNationMaxId(options.databaseUrl, serverId),
            })
        );
        eventActions.set(
            'AutoDeleteInvader',
            createAutoDeleteInvaderHandler({
                getWorld: options.getWorld,
                reservedTurns,
            })
        );
        eventActions.set(
            'ProvideNPCTroopLeader',
            createProvideNpcTroopLeaderHandler({
                getWorld: options.getWorld,
                reservedTurns,
                env: options.commandEnv,
            })
        );
        eventActions.set(
            'UpdateNationLevel',
            createUpdateNationLevelHandler({
                getWorld: options.getWorld,
                reservedTurns,
                itemModules: options.actionModules.itemModules,
                loadAdditionalOccupiedUniqueCounts: () => loadOccupiedAuctionUniqueCounts(options.databaseUrl),
            })
        );
    }
    eventActions.set('InvaderEnding', createInvaderEndingHandler({ getWorld: options.getWorld }));
    eventActions.set('ChangeCity', createChangeCityHandler({ getWorld: options.getWorld }));
    eventActions.set('OpenNationBetting', createOpenNationBettingHandler({ getWorld: options.getWorld }));
    eventActions.set('FinishNationBetting', createFinishNationBettingHandler({ getWorld: options.getWorld }));
    for (const actionName of ['BlockScoutAction', 'UnblockScoutAction'] as const) {
        eventActions.set(
            actionName,
            createScoutBlockHandler({
                actionName,
                getWorld: options.getWorld,
            })
        );
    }
    eventActions.set('AssignGeneralSpeciality', createAssignGeneralSpecialityHandler({ getWorld: options.getWorld }));
    eventActions.set('AddGlobalBetray', createAddGlobalBetrayHandler({ getWorld: options.getWorld }));
    eventActions.set(
        'LostUniqueItem',
        createLostUniqueItemHandler({
            getWorld: options.getWorld,
            itemModules: options.actionModules.itemModules,
        })
    );
    eventActions.set('MergeInheritPointRank', createMergeInheritPointRankHandler({ getWorld: options.getWorld }));
    eventActions.set('AdvanceCentennialAllStar', createAdvanceCentennialAllStarHandler({ getWorld: options.getWorld }));
    eventActions.set('ProcessIncome', createProcessIncomeActionHandler(options.incomeHandler));
    eventActions.set('NoticeToHistoryLog', createNoticeToHistoryLogHandler({ getWorld: options.getWorld }));
    eventActions.set('NewYear', createNewYearHandler({ getWorld: options.getWorld }));
    eventActions.set('ResetOfficerLock', createResetOfficerLockHandler({ getWorld: options.getWorld }));
    return eventActions;
};

interface MonthlyRuntimeCache {
    nationPowerRollCount: number;
    tournamentRollConsumed: boolean;
}

const createMonthlyCalendarRuntime = async (options: {
    databaseUrl: string;
    profileName: string;
    databaseFlushEnabled: boolean;
    snapshot: LoadedTurnWorld['snapshot'];
    currentYear: number;
    commandEnv: ReturnType<typeof buildCommandEnv>;
    incomeHandler: ReturnType<typeof createIncomeHandler>;
    monthlyEventHandler: ReturnType<typeof createMonthlyEventHandler>;
    hasEventAction: (name: string) => boolean;
    calendarHandlerOverride?: TurnCalendarHandler;
    getWorld: () => InMemoryTurnWorld | null;
    getRedisClient: () => ReturnType<typeof createRedisConnector>['client'] | undefined;
    clock: Clock;
}) => {
    const cache: MonthlyRuntimeCache = {
        // Ref's monthly nation query has no Core-only id=0 neutral row.
        nationPowerRollCount: options.snapshot.nations.filter((nation) => nation.id > 0).length,
        tournamentRollConsumed: false,
    };
    const unification = options.calendarHandlerOverride
        ? null
        : createUnificationHandler({
              profileName: options.profileName,
              getWorld: options.getWorld,
              loadPendingUniqueAuctions: options.databaseFlushEnabled
                  ? () => loadPendingUnificationAuctionCancellations(options.databaseUrl)
                  : undefined,
              dispatchUnitedEvents: (context) => options.monthlyEventHandler.dispatchTarget('united', context),
          });
    const monthlyBoundaryPreHandler = createMonthlyBoundaryPreHandler({
        getWorld: options.getWorld,
        startYear: options.snapshot.scenarioMeta?.startYear ?? options.currentYear,
        commandEnv: options.commandEnv,
    });
    const monthlyNationStatsHandler = createMonthlyNationStatsHandler({
        getWorld: options.getWorld,
        onNationPowerRollCount: (count) => {
            cache.nationPowerRollCount = count;
        },
    });
    const neutralAuctionRegistrar = await createNeutralAuctionRegistrar({
        databaseUrl: options.databaseUrl,
        profileName: options.profileName,
        getWorld: options.getWorld,
        getRedisClient: options.getRedisClient,
        getWorldConfig: () => options.getWorld()?.getWorldConfig() ?? options.snapshot.worldConfig ?? null,
        getNationPowerRollCount: () => cache.nationPowerRollCount,
        getTournamentRollConsumed: () => cache.tournamentRollConsumed,
        now: () => options.getWorld()?.getGameNow(new Date(options.clock.nowMs())) ?? new Date(options.clock.nowMs()),
    });
    const tournamentAutoStartHandler = createTournamentAutoStartHandler({
        profileName: options.profileName,
        getWorld: options.getWorld,
        getRedisClient: options.getRedisClient,
        getWorldConfig: () => options.getWorld()?.getWorldConfig() ?? options.snapshot.worldConfig ?? null,
        getNationPowerRollCount: () => cache.nationPowerRollCount,
        onTournamentRollConsumed: (consumed) => {
            cache.tournamentRollConsumed = consumed;
        },
        // Deterministic/manual runtimes must schedule the tournament from the
        // same clock that advances the game world. Production still falls
        // back to the system clock.
        now: () => options.getWorld()?.getGameNow(new Date(options.clock.nowMs())) ?? new Date(options.clock.nowMs()),
    });
    const calendarHandler = composeCalendarHandlers(
        createDynastyStatisticsHandler({ getWorld: options.getWorld }).handler,
        options.monthlyEventHandler,
        options.hasEventAction('ProcessIncome') ? null : options.incomeHandler,
        createYearbookHandler({ profileName: options.profileName, getWorld: options.getWorld }).handler,
        monthlyBoundaryPreHandler,
        createNationTurnMonthlyHandler({ getWorld: options.getWorld }),
        monthlyNationStatsHandler,
        createMonthlyDiplomacyHandler({ getWorld: options.getWorld }),
        createMonthlyWarSettingHandler({ getWorld: options.getWorld }),
        createMonthlyWanderHandler({
            getWorld: options.getWorld,
            startYear: options.snapshot.scenarioMeta?.startYear ?? options.currentYear,
            commandEnv: options.commandEnv,
        }),
        createMonthlyNationCountHandler({ getWorld: options.getWorld }),
        options.calendarHandlerOverride ?? unification?.handler,
        tournamentAutoStartHandler,
        neutralAuctionRegistrar.handler,
        createFrontStateHandler({ getWorld: options.getWorld, map: options.snapshot.map ?? null })
    );
    return { calendarHandler, neutralAuctionRegistrar, cache };
};

const createRealtimeRuntime = async (options: {
    redisUrl?: string;
    profileName: string;
    hooks?: TurnDaemonHooks;
    takeCommittedReadModelChangeReceipt: (() => CommittedReadModelChangeReceipt | null) | null;
}): Promise<{ redisConnector: RedisConnector | null; hooks?: TurnDaemonHooks }> => {
    const redisConfig = resolveRedisConfig(options.redisUrl);
    if (!redisConfig) {
        return { redisConnector: null, hooks: options.hooks };
    }

    const redisConnector = createRedisConnector(redisConfig);
    await redisConnector.connect();
    const redisClient = redisConnector.client;
    const realtimeChannel = buildGameEventChannel(options.profileName);
    const revisionKey = buildGameReadModelRevisionKey(options.profileName);
    const domainRevisionKey = buildGameReadModelDomainRevisionKey(options.profileName);
    const publishRealtimeEvent = async (event: RealtimeEvent): Promise<void> => {
        await redisClient.publish(realtimeChannel, JSON.stringify(event));
    };
    const publishReadModelChanges = async (changes: RealtimeReadModelChanges): Promise<number> => {
        if (
            changes.worldChanged ||
            (changes.mapCityIds ?? changes.cityIds).length > 0 ||
            (changes.mapNationIds ?? changes.nationIds).length > 0
        ) {
            await redisClient.hIncrBy(domainRevisionKey, 'world', 1);
        }
        return redisClient.incr(revisionKey);
    };
    const publishCommittedChanges = async (changes: RealtimeReadModelChanges): Promise<number | undefined> => {
        if (!hasRealtimeReadModelChanges(changes)) {
            return undefined;
        }
        return publishReadModelChanges(changes);
    };
    const basePublishEvents = options.hooks?.publishEvents;
    const basePublishCommandEvents = options.hooks?.publishCommandEvents;
    const hooks: TurnDaemonHooks = {
        ...options.hooks,
        publishEvents: async (result) => {
            try {
                const changes =
                    options.takeCommittedReadModelChangeReceipt?.()?.changes ?? createEmptyRealtimeReadModelChanges();
                const revision = await publishCommittedChanges(changes);
                await publishRealtimeEvent({
                    type: 'turnCompleted',
                    at: new Date().toISOString(),
                    lastTurnTime: result.lastTurnTime,
                    changes,
                    revision,
                });
            } catch {
                // 실시간 이벤트 전송 실패는 턴 처리 결과에 영향을 주지 않는다.
            }
            await basePublishEvents?.(result);
        },
        publishCommandEvents: async (result) => {
            try {
                const changes = options.takeCommittedReadModelChangeReceipt?.()?.changes;
                if (changes && hasRealtimeReadModelChanges(changes)) {
                    const revision = await publishCommittedChanges(changes);
                    if (revision !== undefined) {
                        await publishRealtimeEvent({
                            type: 'readModelChanged',
                            at: new Date().toISOString(),
                            changes,
                            revision,
                        });
                    }
                }
            } catch {
                // 명령은 이미 commit되었으므로 이벤트 실패로 되돌리지 않는다.
            }
            await basePublishCommandEvents?.(result);
        },
    };
    return { redisConnector, hooks };
};

const createStartedAdminActionConsumer = async (options: {
    runtimeOptions: TurnDaemonRuntimeOptions;
    turnDaemonLease: DatabaseTurnDaemonLease | null;
    commandConnector: GamePostgresConnector | null;
    redisConnector: RedisConnector | null;
    controlQueue: TurnDaemonControlQueue;
}) => {
    const profileName = options.runtimeOptions.profileName;
    if (!profileName) {
        return null;
    }
    const consumer = await createGatewayAdminActionConsumer({
        databaseUrl: options.runtimeOptions.databaseUrl,
        gatewayDatabaseUrl: options.runtimeOptions.gatewayDatabaseUrl,
        profileName,
        pollIntervalMs: options.runtimeOptions.adminActionIntervalMs,
        handler: async (action) => {
            const reason = action.reason ?? `admin:${action.action ?? 'action'}`;
            if (options.turnDaemonLease?.isLost()) {
                return { status: 'REQUESTED', detail: 'turn-daemon lease 재획득을 기다리는 중입니다.' };
            }
            if (action.action === 'RESET_NOW' || action.action === 'RESET_SCHEDULED') {
                return { status: 'REQUESTED', detail: 'waiting for orchestrator reset' };
            }
            if (action.action === 'ACCELERATE' || action.action === 'DELAY') {
                if (!options.commandConnector) {
                    return { status: 'FAILED', detail: '게임 command database 연결이 없습니다.' };
                }
                return applyRuntimeClockShift({
                    action,
                    profileName,
                    db: options.commandConnector.prisma,
                    redis: options.redisConnector?.client,
                });
            }
            if (action.action === 'UPDATE_RUNTIME_SETTINGS') {
                if (!options.commandConnector) {
                    return { status: 'FAILED', detail: '게임 command database 연결이 없습니다.' };
                }
                return applyRuntimeGameSettings({
                    action,
                    profileName,
                    db: options.commandConnector.prisma,
                    redis: options.redisConnector?.client,
                });
            }
            switch (action.action) {
                case 'RESUME':
                    options.controlQueue.enqueue({ type: 'resume', reason });
                    return { status: 'APPLIED', detail: 'resume queued' };
                case 'PAUSE':
                    options.controlQueue.enqueue({ type: 'pause', reason });
                    return { status: 'APPLIED', detail: 'pause queued' };
                case 'STOP':
                case 'SHUTDOWN':
                    options.controlQueue.enqueue({ type: 'shutdown', reason });
                    return { status: 'APPLIED', detail: 'shutdown queued' };
                default:
                    return { status: 'IGNORED', detail: 'not implemented' };
            }
        },
    });
    consumer.start();
    return consumer;
};

const createTurnDaemonRuntimeWithLease = async (
    options: TurnDaemonRuntimeOptions,
    databaseFlushEnabled: boolean,
    turnDaemonLease: DatabaseTurnDaemonLease | null
): Promise<TurnDaemonRuntime> => {
    if (options.exclusiveFastForward && options.profileName) {
        throw new Error('exclusiveFastForward cannot be used with a gateway-managed profile.');
    }
    // DB에서 월드를 읽고 턴 데몬을 구동할 런타임을 만든다.
    const { state, snapshot } = await loadTurnWorldFromDatabase({
        databaseUrl: options.databaseUrl,
        mapOptions: options.mapOptions,
    });
    const clock = options.clock ?? new SystemClock();
    const { tickMinutes, resolvedState } = resolveRuntimeState(state, options, clock);
    const schedule = options.schedule ?? buildFixedSchedule(tickMinutes);
    const hasEventAction = (name: string): boolean => hasMonthlyEventAction(snapshot.events, name);
    const eventRequiresReservedTurns = requiresReservedTurnStore(snapshot.events);
    const reservedTurnStoreHandle =
        options.generalTurnHandler && !eventRequiresReservedTurns
            ? null
            : await createReservedTurnStore({
                  databaseUrl: options.databaseUrl,
                  leaseOwner: options.leaseOwnerId,
                  leaseDurationMs: options.leaseDurationMs,
              });
    const commandProfile =
        options.commandProfile ??
        (await loadTurnCommandProfile({
            ...(options.commandProfilePath ? { filePath: options.commandProfilePath } : {}),
            scenarioConst: snapshot.scenarioConfig.const,
        }));
    let worldRef: InMemoryTurnWorld | null = null;
    let redisConnector: RedisConnector | null = null;
    const nationTraits = await loadNationTraitModules([...NATION_TRAIT_KEYS], new NationTraitLoader());
    const nationTraitMap = new Map(nationTraits.map((module) => [module.key, module]));
    const monthlyActionModules = await loadActionModuleBundle(
        snapshot.unitSet,
        snapshot.scenarioConfig.environment.scenarioEffect
    );
    const monthlyCommandEnv = buildCommandEnv(snapshot.scenarioConfig, snapshot.unitSet);
    const incomeHandler = createIncomeHandler({
        getWorld: () => worldRef,
        scenarioConfig: snapshot.scenarioConfig,
        nationTraits: nationTraitMap,
    });
    const eventActions = createMonthlyEventActions({
        databaseUrl: options.databaseUrl,
        snapshot,
        getWorld: () => worldRef,
        reservedTurnStoreHandle,
        commandEnv: monthlyCommandEnv,
        actionModules: monthlyActionModules,
        nationTraits: nationTraitMap,
        incomeHandler,
    });
    const monthlyEventHandler = createMonthlyEventHandler({
        getWorld: () => worldRef,
        startYear: snapshot.scenarioMeta?.startYear ?? state.currentYear,
        actions: eventActions,
    });
    const {
        calendarHandler,
        neutralAuctionRegistrar,
        cache: monthlyRuntimeCache,
    } = await createMonthlyCalendarRuntime({
        databaseUrl: options.databaseUrl,
        profileName: options.profileName ?? options.profile,
        databaseFlushEnabled,
        snapshot,
        currentYear: state.currentYear,
        commandEnv: monthlyCommandEnv,
        incomeHandler,
        monthlyEventHandler,
        hasEventAction,
        calendarHandlerOverride: options.calendarHandler,
        getWorld: () => worldRef,
        getRedisClient: () => redisConnector?.client,
        clock,
    });
    let occupiedAuctionUniqueItemKeys: string[] = [];
    let refreshOccupiedAuctionUniqueItemKeys = async (): Promise<void> => {};
    const prefetchedNationTurns = new Set<string>();
    const worldOptions: InMemoryTurnWorldOptions = {
        schedule,
        generalTurnHandler:
            options.generalTurnHandler ??
            (await createReservedTurnHandler({
                reservedTurns: reservedTurnStoreHandle!.store,
                scenarioConfig: snapshot.scenarioConfig,
                scenarioMeta: snapshot.scenarioMeta,
                map: snapshot.map,
                unitSet: snapshot.unitSet,
                getWorld: () => worldRef,
                now: () => {
                    const wallNow = new Date(clock.nowMs());
                    return worldRef?.getGameNow(wallNow) ?? wallNow;
                },
                commandProfile,
                commandEnv: monthlyCommandEnv,
                calculateNpcNationFinance: (financeWorld, nation, currentMonth) =>
                    calculateNpcNationFinance(financeWorld, nation, currentMonth, {
                        commandEnv: monthlyCommandEnv,
                        scenarioConfig: snapshot.scenarioConfig,
                        unitSet: snapshot.unitSet,
                        nationTraits: nationTraitMap,
                    }),
                getAdditionalOccupiedUniqueItemKeys: () => occupiedAuctionUniqueItemKeys,
                onActionResolved: options.onActionResolved,
            })),
        calendarHandler: calendarHandler ?? undefined,
        autoAdvanceDiplomacyMonth: false,
    };
    const world = new InMemoryTurnWorld(resolvedState, snapshot, worldOptions);
    worldRef = world;

    const stateManager = new EngineStateManager();
    stateManager.register('world', {
        capture: () => world.captureState(),
        restore: (captured) => world.restoreState(captured),
        inspect: () => world.inspectState(),
    });
    if (reservedTurnStoreHandle) {
        stateManager.register('reservedTurns', {
            capture: () => reservedTurnStoreHandle.store.captureTransactionState(),
            restore: (captured) => reservedTurnStoreHandle.store.restoreState(captured),
            inspect: () => reservedTurnStoreHandle.store.inspectState(),
        });
    }
    stateManager.register('runtimeCaches', {
        capture: () => ({
            monthlyNationPowerRollCount: monthlyRuntimeCache.nationPowerRollCount,
            monthlyTournamentRollConsumed: monthlyRuntimeCache.tournamentRollConsumed,
            occupiedAuctionUniqueItemKeys: [...occupiedAuctionUniqueItemKeys],
            prefetchedNationTurns: Array.from(prefetchedNationTurns),
        }),
        restore: (captured) => {
            monthlyRuntimeCache.nationPowerRollCount = captured.monthlyNationPowerRollCount;
            monthlyRuntimeCache.tournamentRollConsumed = captured.monthlyTournamentRollConsumed;
            occupiedAuctionUniqueItemKeys = [...captured.occupiedAuctionUniqueItemKeys];
            prefetchedNationTurns.clear();
            for (const key of captured.prefetchedNationTurns) {
                prefetchedNationTurns.add(key);
            }
        },
    });

    const stateStore = new InMemoryTurnStateStore(world);
    let fastForwardPreparedMonth = '';
    const processor = new InMemoryTurnProcessor(world, {
        dispatchScenarioEvent: (targetCode, context) => monthlyEventHandler.dispatchTarget(targetCode, context),
        beforeExecuteGeneral: reservedTurnStoreHandle
            ? async (general) => {
                  if (options.exclusiveFastForward) {
                      const state = world.getState();
                      const monthKey = `${state.currentYear}-${state.currentMonth}`;
                      if (fastForwardPreparedMonth !== monthKey) {
                          await refreshOccupiedAuctionUniqueItemKeys();
                          fastForwardPreparedMonth = monthKey;
                      }
                      return;
                  }
                  const promises: Promise<unknown>[] = [];
                  promises.push(
                      reservedTurnStoreHandle.store.prepareTurnsForExecution(
                          general.id,
                          general.nationId > 0 && general.officerLevel >= 5
                              ? {
                                    nationId: general.nationId,
                                    officerLevel: general.officerLevel,
                                }
                              : undefined
                      )
                  );
                  promises.push(refreshOccupiedAuctionUniqueItemKeys());
                  if (general.nationId > 0 && general.officerLevel >= 5 && shouldUseAi(general, world.getState())) {
                      const key = `${general.nationId}:${world.getState().currentYear}:${world.getState().currentMonth}`;
                      if (!prefetchedNationTurns.has(key)) {
                          prefetchedNationTurns.add(key);
                          const generalIds = world
                              .listGenerals()
                              .filter((candidate) => candidate.nationId === general.nationId)
                              .map((candidate) => candidate.id);
                          promises.push(reservedTurnStoreHandle.store.prefetchGeneralTurns(generalIds));
                      }
                  }
                  await Promise.all(promises);
              }
            : undefined,
    });
    const controlQueue = options.controlQueue ?? new InMemoryControlQueue();

    let hooks: TurnDaemonHooks | undefined;
    let takeCommittedReadModelChangeReceipt: (() => CommittedReadModelChangeReceipt | null) | null = null;
    let close = async () => {};
    let auctionFinalizer: Awaited<ReturnType<typeof createAuctionFinalizer>> | null = null;
    let auctionBidder: Awaited<ReturnType<typeof createAuctionBidder>> | null = null;
    let tournamentRewardFinalizer: Awaited<ReturnType<typeof createTournamentRewardFinalizer>> | null = null;
    let pauseGate: (() => Promise<boolean>) | undefined;
    let adminActionConsumer: Awaited<ReturnType<typeof createGatewayAdminActionConsumer>> | null = null;
    const gatewayGate = options.profileName
        ? await createGatewayProfileGate({
              databaseUrl: options.databaseUrl,
              gatewayDatabaseUrl: options.gatewayDatabaseUrl,
              profileName: options.profileName,
              cacheMs: options.pauseGateIntervalMs,
          })
        : null;
    if (gatewayGate) {
        pauseGate = gatewayGate.shouldPause;
    }
    if (databaseFlushEnabled) {
        const dbHooks = await createDatabaseTurnHooks(options.databaseUrl, world, {
            profileName: options.profileName ?? options.profile,
            reservedTurns: reservedTurnStoreHandle?.store,
            turnDaemonLease: turnDaemonLease ?? undefined,
            transactionTimeoutMs: options.databaseTransactionTimeoutMs,
        });
        auctionBidder = await createAuctionBidder({
            databaseUrl: options.databaseUrl,
            world,
        });
        auctionFinalizer = await createAuctionFinalizer({
            databaseUrl: options.databaseUrl,
            world,
        });
        tournamentRewardFinalizer = await createTournamentRewardFinalizer({
            databaseUrl: options.databaseUrl,
            world,
        });
        hooks = {
            ...dbHooks.hooks,
            onRunError: async (error) => {
                await dbHooks.hooks.onRunError?.(error);
                await gatewayGate?.markPaused(error);
            },
        };
        takeCommittedReadModelChangeReceipt = dbHooks.takeCommittedReadModelChangeReceipt;
        close = async () => {
            if (auctionBidder) {
                await auctionBidder.close();
            }
            if (auctionFinalizer) {
                await auctionFinalizer.close();
            }
            if (tournamentRewardFinalizer) {
                await tournamentRewardFinalizer.close();
            }
            await dbHooks.close();
            if (reservedTurnStoreHandle) {
                await reservedTurnStoreHandle.close();
            }
            await gatewayGate?.close();
            await adminActionConsumer?.stop();
            await turnDaemonLease?.close();
        };
    } else if (reservedTurnStoreHandle) {
        hooks = {
            onRunError: async (error) => {
                await gatewayGate?.markPaused(error);
            },
        };
        close = async () => {
            await reservedTurnStoreHandle.close();
            await gatewayGate?.close();
            await adminActionConsumer?.stop();
        };
    } else if (gatewayGate) {
        hooks = {
            onRunError: async (error) => {
                await gatewayGate?.markPaused(error);
            },
        };
        close = async () => {
            await gatewayGate.close();
            await adminActionConsumer?.stop();
        };
    } else if (adminActionConsumer) {
        close = async () => {
            await adminActionConsumer?.stop();
        };
    }

    const realtimeRuntime = await createRealtimeRuntime({
        redisUrl: options.redisUrl,
        profileName: options.profileName ?? options.profile,
        hooks,
        takeCommittedReadModelChangeReceipt,
    });
    redisConnector = realtimeRuntime.redisConnector;
    hooks = realtimeRuntime.hooks;

    const commandConnector = hooks ? createGamePostgresConnector({ url: options.databaseUrl }) : null;
    const databaseCommandQueue = commandConnector ? new DatabaseTurnDaemonCommandQueue(commandConnector.prisma) : null;
    if (commandConnector && databaseCommandQueue) {
        await commandConnector.connect();
        await databaseCommandQueue.initialize();
        refreshOccupiedAuctionUniqueItemKeys = async () => {
            const rows = await commandConnector.prisma.auction.findMany({
                where: {
                    type: 'UNIQUE_ITEM',
                    status: { in: ['OPEN', 'FINALIZING'] },
                    targetCode: { not: null },
                },
                select: { targetCode: true },
            });
            occupiedAuctionUniqueItemKeys = rows.flatMap((row) => (row.targetCode ? [row.targetCode] : []));
        };
    }

    const baseClose = close;
    close = async () => {
        await baseClose();
        await neutralAuctionRegistrar.close();
        if (redisConnector) {
            await redisConnector.disconnect();
        }
        await commandConnector?.disconnect();
    };

    const resolvedControlQueue = options.controlQueue ?? databaseCommandQueue ?? controlQueue;
    const commandHandler = createTurnDaemonCommandHandler({
        world,
        reservedTurns: reservedTurnStoreHandle?.store,
        scenarioMeta: snapshot.scenarioMeta,
        map: snapshot.map,
        commandProfile,
        generalActionModules: monthlyActionModules.general,
        getAdditionalOccupiedUniqueItemKeys: () => occupiedAuctionUniqueItemKeys,
        auctionFinalizer: auctionFinalizer ?? undefined,
        auctionBidder: auctionBidder ?? undefined,
        tournamentRewardFinalizer: tournamentRewardFinalizer ?? undefined,
        loadArchivedNationMaxId: (serverId) => loadArchivedNationMaxId(options.databaseUrl, serverId),
    });

    const defaultBudget: TurnRunBudget = options.defaultBudget ?? {
        budgetMs: 5000,
        maxGenerals: 200,
        catchUpCap: 1,
    };

    const lifecycle = new TurnDaemonLifecycle(
        {
            clock,
            controlQueue: resolvedControlQueue,
            getNextTickTime: (lastTurnTime) =>
                getNextTickTime(lastTurnTime, Math.max(1, Math.round(world.getState().tickSeconds / 60))),
            stateStore,
            processor,
            hooks,
            pauseGate: async () => turnDaemonLease?.isLost() || ((await pauseGate?.()) ?? false),
            commandHandler,
            commandResponder: options.controlQueue ? undefined : (databaseCommandQueue ?? undefined),
            // The exclusive fixture runner aborts the entire in-memory runtime
            // on failure and has no concurrent writer. Avoid cloning the whole
            // accumulated world before every due tick in that isolated mode;
            // production and gateway-managed runtimes keep rollback savepoints.
            stateManager: options.exclusiveFastForward ? undefined : stateManager,
        },
        { profile: options.profile, defaultBudget }
    );

    adminActionConsumer = await createStartedAdminActionConsumer({
        runtimeOptions: options,
        turnDaemonLease,
        commandConnector,
        redisConnector,
        controlQueue: resolvedControlQueue,
    });

    return {
        lifecycle,
        world,
        controlQueue: resolvedControlQueue,
        stateStore,
        stateManager,
        processor,
        reservedTurns: reservedTurnStoreHandle?.store ?? null,
        hooks,
        close,
    };
};

export const createTurnDaemonRuntime = async (options: TurnDaemonRuntimeOptions): Promise<TurnDaemonRuntime> => {
    const databaseFlushEnabled = options.enableDatabaseFlush ?? true;
    const turnDaemonLease = databaseFlushEnabled
        ? await DatabaseTurnDaemonLease.connect(options.databaseUrl, {
              profile: options.profileName ?? options.profile,
              ownerId: options.leaseOwnerId,
              leaseDurationMs: options.leaseDurationMs,
              heartbeat: options.enableLeaseHeartbeat,
          })
        : null;
    if (turnDaemonLease && !(await turnDaemonLease.acquire())) {
        await turnDaemonLease.close();
        throw new TurnDaemonLeaseUnavailableError(options.profileName ?? options.profile);
    }
    try {
        return await createTurnDaemonRuntimeWithLease(options, databaseFlushEnabled, turnDaemonLease);
    } catch (error) {
        await turnDaemonLease?.close();
        throw error;
    }
};
