import type { TurnSchedule } from '@sammo-ts/logic';

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
import { createGatewayProfileGate } from './gatewayProfileGate.js';
import { createReservedTurnHandler } from './reservedTurnHandler.js';
import { createReservedTurnStore } from './reservedTurnStore.js';
import { loadTurnWorldFromDatabase } from './worldLoader.js';

export interface TurnDaemonRuntimeOptions {
    profile: string;
    profileName?: string;
    databaseUrl: string;
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
    let worldRef: InMemoryTurnWorld | null = null;
    const worldOptions: InMemoryTurnWorldOptions = {
        schedule,
        generalTurnHandler:
            options.generalTurnHandler ??
            createReservedTurnHandler({
                reservedTurns: reservedTurnStoreHandle!.store,
                scenarioConfig: snapshot.scenarioConfig,
                scenarioMeta: snapshot.scenarioMeta,
                diplomacy: snapshot.diplomacy,
                map: snapshot.map,
                unitSet: snapshot.unitSet,
                getWorld: () => worldRef,
            }),
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
    const gatewayGate =
        options.profileName
            ? await createGatewayProfileGate({
                  databaseUrl: options.databaseUrl,
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
        };
    } else if (gatewayGate) {
        hooks = {
            onRunError: async (error) => {
                await gatewayGate?.markPaused(error);
            },
        };
        close = async () => {
            await gatewayGate.close();
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
