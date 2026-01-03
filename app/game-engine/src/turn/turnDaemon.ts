import type { TurnCommandProfile, TurnSchedule } from '@sammo-ts/logic';

import { SystemClock } from '../lifecycle/clock.js';
import { getNextTickTime } from '../lifecycle/getNextTickTime.js';
import { InMemoryControlQueue } from '../lifecycle/inMemoryControlQueue.js';
import type {
    Clock,
    TurnDaemonControlQueue,
    TurnDaemonHooks,
    TurnRunBudget,
} from '../lifecycle/types.js';
import { TurnDaemonLifecycle } from '../lifecycle/turnDaemonLifecycle.js';
import type { MapLoaderOptions } from '../scenario/mapLoader.js';
import { createDatabaseTurnHooks } from './databaseHooks.js';
import type {
    GeneralTurnHandler,
    InMemoryTurnWorldOptions,
    TurnCalendarHandler,
} from './inMemoryWorld.js';
import { InMemoryTurnWorld } from './inMemoryWorld.js';
import { InMemoryTurnProcessor } from './inMemoryTurnProcessor.js';
import { InMemoryTurnStateStore } from './inMemoryStateStore.js';
import { createGatewayAdminActionConsumer } from './gatewayAdminActions.js';
import { createGatewayProfileGate } from './gatewayProfileGate.js';
import { createReservedTurnHandler } from './reservedTurnHandler.js';
import { createReservedTurnStore } from './reservedTurnStore.js';
import { loadTurnCommandProfile } from './turnCommandProfile.js';
import { loadTurnWorldFromDatabase } from './worldLoader.js';
import { seedScenarioToDatabase } from '../scenario/scenarioSeeder.js';
import { createGamePostgresConnector, createGatewayPostgresConnector } from '@sammo-ts/infra';

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

export const createTurnDaemonRuntime = async (
    options: TurnDaemonRuntimeOptions
): Promise<TurnDaemonRuntime> => {
    // DB에서 월드를 읽고 턴 데몬을 구동할 런타임을 만든다.
    const { state, snapshot } = await loadTurnWorldFromDatabase({
        databaseUrl: options.databaseUrl,
        mapOptions: options.mapOptions,
    });

    const tickMinutes = resolveTickMinutes(state.tickSeconds, options.tickMinutes);
    const resolvedState = options.tickMinutes
        ? { ...state, tickSeconds: tickMinutes * 60 }
        : state;
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
    const processor = new InMemoryTurnProcessor(world, {
        tickMinutes,
        beforeExecuteGeneral: reservedTurnStoreHandle
            ? async (general) => {
                  await reservedTurnStoreHandle.store.refreshGeneralTurns(
                      general.id
                  );
                  if (general.nationId > 0 && general.officerLevel >= 5) {
                      await reservedTurnStoreHandle.store.refreshNationTurns(
                          general.nationId,
                          general.officerLevel
                      );
                  }
              }
            : undefined,
    });
    const controlQueue = options.controlQueue ?? new InMemoryControlQueue();
    const clock = options.clock ?? new SystemClock();

    let hooks: TurnDaemonHooks | undefined;
    let close = async () => {};
    let pauseGate: (() => Promise<boolean>) | undefined;
    let adminActionConsumer: Awaited<
        ReturnType<typeof createGatewayAdminActionConsumer>
    > | null = null;
    const gatewayGate =
        options.profileName
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

    const defaultBudget: TurnRunBudget = options.defaultBudget ?? {
        budgetMs: 5000,
        maxGenerals: 200,
        catchUpCap: 1,
    };

    const lifecycle = new TurnDaemonLifecycle(
        {
            clock,
            controlQueue,
            getNextTickTime: (lastTurnTime) =>
                getNextTickTime(lastTurnTime, tickMinutes),
            stateStore,
            processor,
            hooks,
            pauseGate,
        },
        { profile: options.profile, defaultBudget }
    );

    const resolveScenarioId = async (): Promise<number | null> => {
        const meta = world.getState().meta as Record<string, unknown>;
        const raw = meta.scenarioId;
        if (typeof raw === 'number' && Number.isFinite(raw)) {
            return Math.floor(raw);
        }
        if (typeof raw === 'string') {
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) {
                return Math.floor(parsed);
            }
        }
        const connector = createGamePostgresConnector({ url: options.databaseUrl });
        await connector.connect();
        try {
            const prisma = connector.prisma as unknown as {
                worldState: { findFirst: (args: unknown) => Promise<{ scenarioCode: string } | null> };
            };
            const row = await prisma.worldState.findFirst({
                select: { scenarioCode: true },
            });
            if (!row) {
                return null;
            }
            const parsed = Number(row.scenarioCode);
            return Number.isFinite(parsed) ? Math.floor(parsed) : null;
        } finally {
            await connector.disconnect();
        }
    };

    const updateGatewayProfileStatus = async (
        nextStatus: 'RUNNING' | 'STOPPED'
    ): Promise<{ previous?: string; updated: boolean }> => {
        const connector = createGatewayPostgresConnector({
            url: options.gatewayDatabaseUrl ?? options.databaseUrl,
        });
        await connector.connect();
        try {
            const prisma = connector.prisma as unknown as {
                gatewayProfile: {
                    findUnique: (args: unknown) => Promise<{ status: string } | null>;
                    update: (args: unknown) => Promise<void>;
                };
            };
            const profile = await prisma.gatewayProfile.findUnique({
                where: { profileName: options.profileName },
                select: { status: true },
            });
            if (!profile) {
                return { updated: false };
            }
            if (profile.status === 'DISABLED') {
                return { previous: profile.status, updated: false };
            }
            await prisma.gatewayProfile.update({
                where: { profileName: options.profileName },
                data: {
                    status: nextStatus,
                    lastError: null,
                },
            });
            return { previous: profile.status, updated: true };
        } finally {
            await connector.disconnect();
        }
    };

    let resetInFlight = false;

    if (options.profileName) {
        adminActionConsumer = await createGatewayAdminActionConsumer({
            databaseUrl: options.databaseUrl,
            gatewayDatabaseUrl: options.gatewayDatabaseUrl,
            profileName: options.profileName,
            pollIntervalMs: options.adminActionIntervalMs,
            handler: async (action) => {
                const reason = action.reason ?? `admin:${action.action ?? 'action'}`;
                if (action.action === 'RESET_NOW' || action.action === 'RESET_SCHEDULED') {
                    if (resetInFlight) {
                        return { status: 'IGNORED', detail: 'reset already in progress' };
                    }
                    if (action.action === 'RESET_SCHEDULED') {
                        if (!action.scheduledAt) {
                            return { status: 'FAILED', detail: 'scheduledAt is required' };
                        }
                        const scheduledAt = new Date(action.scheduledAt);
                        if (Number.isNaN(scheduledAt.getTime())) {
                            return { status: 'FAILED', detail: 'scheduledAt is invalid' };
                        }
                        if (scheduledAt.getTime() > Date.now()) {
                            return { status: 'REQUESTED', detail: 'waiting for schedule' };
                        }
                    }
                    resetInFlight = true;
                    try {
                        await lifecycle.stop('admin reset');
                        const scenarioId = await resolveScenarioId();
                        if (!scenarioId) {
                            return { status: 'FAILED', detail: 'scenarioId is missing' };
                        }
                        const seedTime =
                            action.scheduledAt && action.action === 'RESET_SCHEDULED'
                                ? new Date(action.scheduledAt)
                                : new Date();
                        await seedScenarioToDatabase({
                            databaseUrl: options.databaseUrl,
                            scenarioId,
                            tickSeconds: world.getState().tickSeconds,
                            now: seedTime,
                        });
                        const statusUpdate = await updateGatewayProfileStatus('RUNNING');
                        return {
                            status: 'APPLIED',
                            detail: statusUpdate.updated
                                ? `seeded scenario ${scenarioId}; status RUNNING`
                                : `seeded scenario ${scenarioId}; status unchanged`,
                        };
                    } finally {
                        resetInFlight = false;
                    }
                }
                switch (action.action) {
                    case 'RESUME':
                        controlQueue.enqueue({ type: 'resume', reason });
                        return { status: 'APPLIED', detail: 'resume queued' };
                    case 'PAUSE':
                        controlQueue.enqueue({ type: 'pause', reason });
                        return { status: 'APPLIED', detail: 'pause queued' };
                    case 'STOP':
                    case 'SHUTDOWN':
                        controlQueue.enqueue({ type: 'shutdown', reason });
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
        controlQueue,
        stateStore,
        processor,
        hooks,
        close,
    };
};
