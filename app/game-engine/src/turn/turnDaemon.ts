import type { TurnCommandProfile, TurnSchedule } from '@sammo-ts/logic';
import { createRedisConnector, resolveRedisConfigFromEnv } from '@sammo-ts/infra';

import { SystemClock } from '../lifecycle/clock.js';
import { getNextTickTime } from '../lifecycle/getNextTickTime.js';
import { InMemoryControlQueue } from '../lifecycle/inMemoryControlQueue.js';
import type { Clock, TurnDaemonControlQueue, TurnDaemonHooks, TurnRunBudget } from '../lifecycle/types.js';
import { TurnDaemonLifecycle } from '../lifecycle/turnDaemonLifecycle.js';
import { buildTurnDaemonStreamKeys, RedisTurnDaemonCommandStream } from '../lifecycle/redisCommandStream.js';
import type { MapLoaderOptions } from '../scenario/mapLoader.js';
import { createDatabaseTurnHooks } from './databaseHooks.js';
import type { GeneralTurnHandler, InMemoryTurnWorldOptions, TurnCalendarHandler } from './inMemoryWorld.js';
import { InMemoryTurnWorld } from './inMemoryWorld.js';
import { InMemoryTurnProcessor } from './inMemoryTurnProcessor.js';
import { InMemoryTurnStateStore } from './inMemoryStateStore.js';
import { createGatewayAdminActionConsumer } from './gatewayAdminActions.js';
import { createGatewayProfileGate } from './gatewayProfileGate.js';
import { createReservedTurnHandler } from './reservedTurnHandler.js';
import { createReservedTurnStore } from './reservedTurnStore.js';
import { createTurnDaemonCommandHandler } from './worldCommandHandler.js';
import { loadTurnCommandProfile } from './turnCommandProfile.js';
import { loadTurnWorldFromDatabase } from './worldLoader.js';
import { shouldUseAi } from './ai/generalAi.js';

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

const resolveRedisConfig = (redisUrl?: string, env: NodeJS.ProcessEnv = process.env) => {
    if (redisUrl) {
        return { url: redisUrl };
    }
    if (!env.REDIS_URL) {
        return null;
    }
    return resolveRedisConfigFromEnv(env);
};

export const createTurnDaemonRuntime = async (options: TurnDaemonRuntimeOptions): Promise<TurnDaemonRuntime> => {
    // DB에서 월드를 읽고 턴 데몬을 구동할 런타임을 만든다.
    const { state, snapshot } = await loadTurnWorldFromDatabase({
        databaseUrl: options.databaseUrl,
        mapOptions: options.mapOptions,
    });

    const tickMinutes = resolveTickMinutes(state.tickSeconds, options.tickMinutes);
    const resolvedState = options.tickMinutes ? { ...state, tickSeconds: tickMinutes * 60 } : state;
    const schedule = options.schedule ?? buildFixedSchedule(tickMinutes);
    const reservedTurnStoreHandle = options.generalTurnHandler
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
        calendarHandler: options.calendarHandler,
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
    let close = async () => {};
    let redisCommandStream: RedisTurnDaemonCommandStream | null = null;
    let redisConnector: ReturnType<typeof createRedisConnector> | null = null;
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
    if (options.enableDatabaseFlush ?? true) {
        const dbHooks = await createDatabaseTurnHooks(options.databaseUrl, world, {
            reservedTurns: reservedTurnStoreHandle?.store,
        });
        hooks = {
            ...dbHooks.hooks,
            onRunError: async (error) => {
                await dbHooks.hooks.onRunError?.(error);
                await gatewayGate?.markPaused(error);
            },
        };
        close = async () => {
            await dbHooks.close();
            if (reservedTurnStoreHandle) {
                await reservedTurnStoreHandle.close();
            }
            await gatewayGate?.close();
            await adminActionConsumer?.stop();
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
        redisCommandStream = new RedisTurnDaemonCommandStream(redisConnector.client, {
            keys: buildTurnDaemonStreamKeys(options.profileName ?? options.profile),
            startId: options.commandStreamStartId,
        });
    }

    const baseClose = close;
    close = async () => {
        await baseClose();
        if (redisConnector) {
            await redisConnector.disconnect();
        }
    };

    const resolvedControlQueue = options.controlQueue ?? redisCommandStream ?? controlQueue;
    const commandHandler = createTurnDaemonCommandHandler({
        world,
        hooks,
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
            pauseGate,
            commandHandler,
            commandResponder: redisCommandStream ?? undefined,
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
