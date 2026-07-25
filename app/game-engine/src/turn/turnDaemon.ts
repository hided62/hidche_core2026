import {
    LogCategory,
    LogScope,
    loadActionModuleBundle,
    type TurnCommandProfile,
    type TurnSchedule,
} from '@sammo-ts/logic';
import { buildGameEventChannel, type RealtimeEvent } from '@sammo-ts/common';
import { createGamePostgresConnector, createRedisConnector, resolveRedisConfigFromEnv } from '@sammo-ts/infra';
import { NATION_TRAIT_KEYS, NationTraitLoader, loadNationTraitModules } from '@sammo-ts/logic';

import { SystemClock } from '../lifecycle/clock.js';
import { getNextTickTime } from '../lifecycle/getNextTickTime.js';
import { InMemoryControlQueue } from '../lifecycle/inMemoryControlQueue.js';
import type { Clock, TurnDaemonControlQueue, TurnDaemonHooks, TurnRunBudget } from '../lifecycle/types.js';
import { TurnDaemonLifecycle } from '../lifecycle/turnDaemonLifecycle.js';
import { DatabaseTurnDaemonCommandQueue } from '../lifecycle/databaseCommandQueue.js';
import type { MapLoaderOptions } from '../scenario/mapLoader.js';
import { createDatabaseTurnHooks } from './databaseHooks.js';
import type { GeneralTurnHandler, InMemoryTurnWorldOptions, TurnCalendarHandler } from './inMemoryWorld.js';
import { InMemoryTurnWorld } from './inMemoryWorld.js';
import { InMemoryTurnProcessor } from './inMemoryTurnProcessor.js';
import { InMemoryTurnStateStore } from './inMemoryStateStore.js';
import { createGatewayAdminActionConsumer } from './gatewayAdminActions.js';
import { createGatewayProfileGate } from './gatewayProfileGate.js';
import { composeCalendarHandlers } from './calendarHandlers.js';
import { createIncomeHandler } from './incomeHandler.js';
import { createNationTurnMonthlyHandler } from './nationTurnMonthlyHandler.js';
import { createFrontStateHandler } from './frontStateHandler.js';
import { createReservedTurnHandler } from './reservedTurnHandler.js';
import { createReservedTurnStore } from './reservedTurnStore.js';
import { createTurnDaemonCommandHandler } from './worldCommandHandler.js';
import { loadTurnCommandProfile } from './turnCommandProfile.js';
import { loadTurnWorldFromDatabase } from './worldLoader.js';
import { shouldUseAi } from './ai/generalAi.js';
import { createUnificationHandler } from './unificationHandler.js';
import { createAuctionFinalizer } from '../auction/finalizer.js';
import { createAuctionBidder } from '../auction/bidder.js';
import { createNeutralAuctionRegistrar } from '../auction/neutralRegistrar.js';
import { createTournamentRewardFinalizer } from '../tournament/finalizer.js';
import { createTournamentAutoStartHandler } from './tournamentAutoStart.js';
import { createYearbookHandler } from './yearbookHandler.js';
import {
    createMonthlyEventHandler,
    createRandomizeCityTradeRateHandler,
    type MonthlyEventActionHandler,
} from './monthlyEventHandler.js';
import { createRaiseDisasterHandler } from './monthlyDisasterAction.js';
import { createUpdateCitySupplyHandler } from './monthlyCitySupplyAction.js';
import { createUpdateNationLevelHandler } from './monthlyNationLevelAction.js';
import { createProcessSemiAnnualHandler } from './monthlySemiAnnualAction.js';
import { DatabaseTurnDaemonLease, TurnDaemonLeaseUnavailableError } from '../lifecycle/databaseTurnDaemonLease.js';

export interface TurnDaemonRuntimeOptions {
    profile: string;
    profileName?: string;
    databaseUrl: string;
    gatewayDatabaseUrl?: string;
    defaultBudget?: TurnRunBudget;
    clock?: Clock;
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
}

export interface TurnDaemonRuntime {
    lifecycle: TurnDaemonLifecycle;
    world: InMemoryTurnWorld;
    controlQueue: TurnDaemonControlQueue;
    stateStore: InMemoryTurnStateStore;
    processor: InMemoryTurnProcessor;
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

const resolveRedisConfig = (redisUrl?: string, env: NodeJS.ProcessEnv = process.env) => {
    if (redisUrl) {
        return { url: redisUrl };
    }
    if (!env.REDIS_URL) {
        return null;
    }
    return resolveRedisConfigFromEnv(env);
};

const createTurnDaemonRuntimeWithLease = async (
    options: TurnDaemonRuntimeOptions,
    databaseFlushEnabled: boolean,
    turnDaemonLease: DatabaseTurnDaemonLease | null
): Promise<TurnDaemonRuntime> => {
    // DB에서 월드를 읽고 턴 데몬을 구동할 런타임을 만든다.
    const { state, snapshot } = await loadTurnWorldFromDatabase({
        databaseUrl: options.databaseUrl,
        mapOptions: options.mapOptions,
    });

    const tickMinutes = resolveTickMinutes(state.tickSeconds, options.tickMinutes);
    const resolvedState = options.tickMinutes ? { ...state, tickSeconds: tickMinutes * 60 } : state;
    const schedule = options.schedule ?? buildFixedSchedule(tickMinutes);
    const hasEventAction = (name: string): boolean =>
        snapshot.events.some(
            (event) =>
                Array.isArray(event.action) &&
                event.action.some((action) => Array.isArray(action) && action[0] === name)
        );
    const reservedTurnStoreHandle =
        options.generalTurnHandler && !hasEventAction('UpdateNationLevel')
            ? null
            : await createReservedTurnStore({
                  databaseUrl: options.databaseUrl,
              });
    const commandProfile =
        options.commandProfile ??
        (options.commandProfilePath
            ? await loadTurnCommandProfile({
                  filePath: options.commandProfilePath,
              })
            : await loadTurnCommandProfile());
    let worldRef: InMemoryTurnWorld | null = null;
    let redisConnector: ReturnType<typeof createRedisConnector> | null = null;
    const nationTraits = await loadNationTraitModules([...NATION_TRAIT_KEYS], new NationTraitLoader());
    const nationTraitMap = new Map(nationTraits.map((module) => [module.key, module]));
    const monthlyActionModules = await loadActionModuleBundle(snapshot.unitSet);
    const unification = options.calendarHandler
        ? null
        : createUnificationHandler({
              databaseUrl: options.databaseUrl,
              profileName: options.profileName ?? options.profile,
              getWorld: () => worldRef,
          });
    const incomeHandler = createIncomeHandler({
        getWorld: () => worldRef,
        scenarioConfig: snapshot.scenarioConfig,
        nationTraits: nationTraitMap,
    });
    const eventActions = new Map<string, MonthlyEventActionHandler>();
    eventActions.set(
        'RandomizeCityTradeRate',
        createRandomizeCityTradeRateHandler({
            getWorld: () => worldRef,
        })
    );
    eventActions.set(
        'RaiseDisaster',
        createRaiseDisasterHandler({
            getWorld: () => worldRef,
            generalActionModules: monthlyActionModules.general,
        })
    );
    eventActions.set(
        'UpdateCitySupply',
        createUpdateCitySupplyHandler({
            getWorld: () => worldRef,
            map: snapshot.map,
        })
    );
    eventActions.set(
        'ProcessSemiAnnual',
        createProcessSemiAnnualHandler({
            getWorld: () => worldRef,
            nationTraits: nationTraitMap,
        })
    );
    if (reservedTurnStoreHandle) {
        eventActions.set(
            'UpdateNationLevel',
            createUpdateNationLevelHandler({
                getWorld: () => worldRef,
                reservedTurns: reservedTurnStoreHandle.store,
                itemModules: monthlyActionModules.itemModules,
                loadAdditionalOccupiedUniqueCounts: () => loadOccupiedAuctionUniqueCounts(options.databaseUrl),
            })
        );
    }
    eventActions.set('ProcessIncome', async (_args, environment) => {
        await incomeHandler.onMonthChanged?.({
            previousYear: environment.month === 1 ? environment.year - 1 : environment.year,
            previousMonth: environment.month === 1 ? 12 : environment.month - 1,
            currentYear: environment.year,
            currentMonth: environment.month,
            turnTime: environment.turnTime,
        });
    });
    eventActions.set('NoticeToHistoryLog', (args) => {
        const text = args[0];
        if (typeof text !== 'string' || !worldRef) {
            return;
        }
        worldRef.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            text,
        });
    });
    eventActions.set('NewYear', (_args, environment) => {
        if (!worldRef) {
            return;
        }
        for (const general of worldRef.listGenerals()) {
            const belong = general.meta.belong;
            worldRef.updateGeneral(general.id, {
                age: general.age + 1,
                meta: {
                    ...general.meta,
                    ...(general.nationId !== 0
                        ? { belong: typeof belong === 'number' && Number.isFinite(belong) ? belong + 1 : 1 }
                        : {}),
                },
            });
        }
        worldRef.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.ACTION,
            text: `<C>${environment.year}</>년이 되었습니다.`,
        });
    });
    eventActions.set('ResetOfficerLock', () => {
        if (!worldRef) {
            return;
        }
        for (const nation of worldRef.listNations()) {
            worldRef.updateNation(nation.id, { meta: { ...nation.meta, chief_set: 0 } });
        }
        for (const city of worldRef.listCities()) {
            worldRef.updateCity(city.id, { meta: { ...city.meta, officer_set: 0 } });
        }
    });
    const monthlyEventHandler = createMonthlyEventHandler({
        getWorld: () => worldRef,
        startYear: snapshot.scenarioMeta?.startYear ?? state.currentYear,
        actions: eventActions,
    });
    const nationTurnMonthlyHandler = createNationTurnMonthlyHandler({
        getWorld: () => worldRef,
    });
    const frontStateHandler = createFrontStateHandler({
        getWorld: () => worldRef,
        map: snapshot.map ?? null,
    });
    const neutralAuctionRegistrar = await createNeutralAuctionRegistrar({
        databaseUrl: options.databaseUrl,
        profileName: options.profileName ?? options.profile,
        getWorld: () => worldRef,
        getRedisClient: () => redisConnector?.client,
        getWorldConfig: () => snapshot.worldConfig ?? null,
    });
    const tournamentAutoStartHandler = createTournamentAutoStartHandler({
        profileName: options.profileName ?? options.profile,
        getRedisClient: () => redisConnector?.client,
        getWorldConfig: () => snapshot.worldConfig ?? null,
        getTickSeconds: () => worldRef?.getState().tickSeconds ?? null,
    });
    const yearbookHandler = createYearbookHandler({
        databaseUrl: options.databaseUrl,
        profileName: options.profileName ?? options.profile,
        getWorld: () => worldRef,
    });
    const calendarHandler = composeCalendarHandlers(
        monthlyEventHandler,
        options.calendarHandler ?? unification?.handler,
        nationTurnMonthlyHandler,
        hasEventAction('ProcessIncome') ? null : incomeHandler,
        frontStateHandler,
        neutralAuctionRegistrar.handler,
        tournamentAutoStartHandler,
        yearbookHandler.handler
    );
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
                commandProfile,
            })),
        calendarHandler: calendarHandler ?? undefined,
    };
    const world = new InMemoryTurnWorld(resolvedState, snapshot, worldOptions);
    worldRef = world;

    const stateStore = new InMemoryTurnStateStore(world);
    const prefetchedNationTurns = new Set<string>();
    const processor = new InMemoryTurnProcessor(world, {
        tickMinutes,
        beforeExecuteGeneral: reservedTurnStoreHandle
            ? async (general) => {
                  const promises: Promise<unknown>[] = [];
                  promises.push(reservedTurnStoreHandle.store.refreshGeneralTurns(general.id));
                  if (general.nationId > 0 && general.officerLevel >= 5) {
                      promises.push(
                          reservedTurnStoreHandle.store.refreshNationTurns(general.nationId, general.officerLevel)
                      );
                  }
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
    const clock = options.clock ?? new SystemClock();

    let hooks: TurnDaemonHooks | undefined;
    let publishRealtimeEvent: ((event: RealtimeEvent) => Promise<void>) | null = null;
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
            reservedTurns: reservedTurnStoreHandle?.store,
            turnDaemonLease: turnDaemonLease ?? undefined,
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

    const redisConfig = resolveRedisConfig(options.redisUrl);
    if (redisConfig) {
        redisConnector = createRedisConnector(redisConfig);
        await redisConnector.connect();
        const redisClient = redisConnector.client;
        const realtimeChannel = buildGameEventChannel(options.profileName ?? options.profile);
        publishRealtimeEvent = async (event: RealtimeEvent) => {
            await redisClient.publish(realtimeChannel, JSON.stringify(event));
        };
    }

    if (publishRealtimeEvent) {
        const basePublishEvents = hooks?.publishEvents;
        // 턴 처리 완료 이벤트를 실시간 채널로 전파한다.
        hooks = {
            ...hooks,
            publishEvents: async (result) => {
                try {
                    await publishRealtimeEvent({
                        type: 'turnCompleted',
                        at: new Date().toISOString(),
                        lastTurnTime: result.lastTurnTime,
                    });
                } catch {
                    // 실시간 이벤트 전송 실패는 턴 처리 결과에 영향을 주지 않는다.
                }
                await basePublishEvents?.(result);
            },
        };
    }

    const commandConnector = hooks ? createGamePostgresConnector({ url: options.databaseUrl }) : null;
    const databaseCommandQueue = commandConnector ? new DatabaseTurnDaemonCommandQueue(commandConnector.prisma) : null;
    if (commandConnector && databaseCommandQueue) {
        await commandConnector.connect();
        await databaseCommandQueue.initialize();
    }

    const baseClose = close;
    close = async () => {
        await baseClose();
        await neutralAuctionRegistrar.close();
        if (unification) {
            await unification.close();
        }
        await yearbookHandler.close();
        if (redisConnector) {
            await redisConnector.disconnect();
        }
        await commandConnector?.disconnect();
    };

    const resolvedControlQueue = options.controlQueue ?? databaseCommandQueue ?? controlQueue;
    const commandHandler = createTurnDaemonCommandHandler({
        world,
        auctionFinalizer: auctionFinalizer ?? undefined,
        auctionBidder: auctionBidder ?? undefined,
        tournamentRewardFinalizer: tournamentRewardFinalizer ?? undefined,
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
            getNextTickTime: (lastTurnTime) => getNextTickTime(lastTurnTime, tickMinutes),
            stateStore,
            processor,
            hooks,
            pauseGate: async () => turnDaemonLease?.isLost() || ((await pauseGate?.()) ?? false),
            commandHandler,
            commandResponder: options.controlQueue ? undefined : (databaseCommandQueue ?? undefined),
        },
        { profile: options.profile, defaultBudget }
    );

    if (options.profileName) {
        adminActionConsumer = await createGatewayAdminActionConsumer({
            databaseUrl: options.databaseUrl,
            gatewayDatabaseUrl: options.gatewayDatabaseUrl,
            profileName: options.profileName,
            pollIntervalMs: options.adminActionIntervalMs,
            handler: async (action) => {
                const reason = action.reason ?? `admin:${action.action ?? 'action'}`;
                if (action.action === 'RESET_NOW' || action.action === 'RESET_SCHEDULED') {
                    // 리셋은 오케스트레이터에서 빌드+재기동으로 처리한다.
                    return { status: 'REQUESTED', detail: 'waiting for orchestrator reset' };
                }
                switch (action.action) {
                    case 'RESUME':
                        resolvedControlQueue.enqueue({ type: 'resume', reason });
                        return { status: 'APPLIED', detail: 'resume queued' };
                    case 'PAUSE':
                        resolvedControlQueue.enqueue({ type: 'pause', reason });
                        return { status: 'APPLIED', detail: 'pause queued' };
                    case 'STOP':
                    case 'SHUTDOWN':
                        resolvedControlQueue.enqueue({ type: 'shutdown', reason });
                        return { status: 'APPLIED', detail: 'shutdown queued' };
                    default:
                        return { status: 'IGNORED', detail: 'not implemented' };
                }
            },
        });
        adminActionConsumer.start();
    }

    return {
        lifecycle,
        world,
        controlQueue: resolvedControlQueue,
        stateStore,
        processor,
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
