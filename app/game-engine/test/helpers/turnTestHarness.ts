import { vi } from 'vitest';
import type { LogEntryDraft, MapDefinition, TurnSchedule } from '@sammo-ts/logic';
import type { TurnWorldSnapshot, TurnWorldState } from '../../src/turn/types.js';
import type { InMemoryTurnWorld, GeneralTurnHandler } from '../../src/turn/inMemoryWorld.js';
import type { TurnCalendarHandler } from '../../src/turn/inMemoryWorld.js';
import { InMemoryTurnWorld as InMemoryTurnWorldClass } from '../../src/turn/inMemoryWorld.js';
import { InMemoryReservedTurnStore } from '../../src/turn/reservedTurnStore.js';
import { createReservedTurnHandler } from '../../src/turn/reservedTurnHandler.js';
import type { InMemoryTurnProcessorOptions } from '../../src/turn/inMemoryTurnProcessor.js';
import { InMemoryTurnProcessor } from '../../src/turn/inMemoryTurnProcessor.js';
import { composeCalendarHandlers } from '../../src/turn/calendarHandlers.js';
import { createIncomeHandler } from '../../src/turn/incomeHandler.js';
import { createNpcTaxHandler } from '../../src/turn/npcTaxHandler.js';
import { createFrontStateHandler } from '../../src/turn/frontStateHandler.js';

export const createMockPrisma = (initialGeneralRows: any[] = []) => {
    let generalRows = [...initialGeneralRows];
    return {
        generalTurn: {
            findMany: vi.fn(async ({ where } = {}) => {
                if (where?.generalId) {
                    return generalRows
                        .filter((row) => row.generalId === where.generalId)
                        .sort((a, b) => a.turnIdx - b.turnIdx);
                }
                return generalRows;
            }),
            deleteMany: vi.fn(async ({ where } = {}) => {
                if (where?.generalId) {
                    generalRows = generalRows.filter((row) => row.generalId !== where.generalId);
                }
                return { count: 0 };
            }),
            createMany: vi.fn(async ({ data }) => {
                if (Array.isArray(data)) {
                    generalRows.push(...data);
                }
                return { count: data.length };
            }),
        },
        nationTurn: {
            findMany: vi.fn(async () => []),
            deleteMany: vi.fn(async () => ({ count: 0 })),
            createMany: vi.fn(async () => ({ count: 0 })),
        },
    };
};

export const addMinutes = (time: Date, minutes: number): Date => new Date(time.getTime() + minutes * 60_000);

export type TurnHarnessRunOptions = {
    minutes?: number;
    budgetMs?: number;
    maxGenerals?: number;
    catchUpCap?: number;
};

export type TurnTestHarnessOptions = {
    snapshot: TurnWorldSnapshot;
    state: TurnWorldState;
    schedule: TurnSchedule;
    map?: MapDefinition;
    reservedTurnStoreOptions?: {
        maxGeneralTurns: number;
        maxNationTurns: number;
    };
    turnProcessorOptions?: {
        tickMinutes: number;
        afterExecuteGeneral?: InMemoryTurnProcessorOptions['afterExecuteGeneral'];
    };
    worldRef?: { current: InMemoryTurnWorld | null };
    onActionResolved?: Parameters<typeof createReservedTurnHandler>[0]['onActionResolved'];
    wrapGeneralTurnHandler?: (handler: GeneralTurnHandler) => GeneralTurnHandler;
    extraCalendarHandlers?: TurnCalendarHandler[];
    collectLogs?: boolean;
};

const defaultRunOptions = {
    budgetMs: 10000,
    maxGenerals: 100000,
    catchUpCap: 1,
} satisfies Required<Omit<TurnHarnessRunOptions, 'minutes'>>;

export const createTurnTestHarness = async (options: TurnTestHarnessOptions) => {
    const mockPrisma = createMockPrisma();
    const reservedTurnStore = new InMemoryReservedTurnStore(mockPrisma as any, {
        maxGeneralTurns: 10,
        maxNationTurns: 10,
        ...(options.reservedTurnStoreOptions ?? {}),
    });
    await reservedTurnStore.loadAll();

    const worldRef = options.worldRef ?? { current: null as InMemoryTurnWorld | null };

    const handler = await createReservedTurnHandler({
        reservedTurns: reservedTurnStore,
        scenarioConfig: options.snapshot.scenarioConfig,
        scenarioMeta: options.snapshot.scenarioMeta,
        map: options.map,
        unitSet: options.snapshot.unitSet,
        getWorld: () => worldRef.current,
        onActionResolved: options.onActionResolved,
    });

    const generalTurnHandler = options.wrapGeneralTurnHandler ? options.wrapGeneralTurnHandler(handler) : handler;

    const incomeHandler = createIncomeHandler({
        getWorld: () => worldRef.current,
        scenarioConfig: options.snapshot.scenarioConfig,
        nationTraits: new Map(),
    });

    const npcTaxHandler = createNpcTaxHandler({
        getWorld: () => worldRef.current,
    });

    const frontStateHandler = createFrontStateHandler({
        getWorld: () => worldRef.current,
        map: options.map,
    });

    const calendarHandler = composeCalendarHandlers(
        incomeHandler,
        npcTaxHandler,
        frontStateHandler,
        ...(options.extraCalendarHandlers ?? [])
    );

    const world = new InMemoryTurnWorldClass(options.state, options.snapshot, {
        schedule: options.schedule,
        generalTurnHandler,
        calendarHandler,
    });
    worldRef.current = world;

    const processor = new InMemoryTurnProcessor(world, {
        tickMinutes: options.turnProcessorOptions?.tickMinutes ?? 10,
        afterExecuteGeneral: options.turnProcessorOptions?.afterExecuteGeneral,
    });

    const collectedLogs: LogEntryDraft[] = [];

    const collectWorldLogs = () => {
        if (!options.collectLogs) {
            return;
        }
        const { logs } = world.consumeDirtyState();
        if (logs.length > 0) {
            collectedLogs.push(...logs);
        }
    };

    const runOneTick = async (runOptions: TurnHarnessRunOptions = {}) => {
        const minutes = runOptions.minutes ?? options.turnProcessorOptions?.tickMinutes ?? 10;
        const target = addMinutes(world.getState().lastTurnTime, minutes);
        await processor.run(target, {
            budgetMs: runOptions.budgetMs ?? defaultRunOptions.budgetMs,
            maxGenerals: runOptions.maxGenerals ?? defaultRunOptions.maxGenerals,
            catchUpCap: runOptions.catchUpCap ?? defaultRunOptions.catchUpCap,
        });
        collectWorldLogs();
    };

    const runUntil = async (
        shouldStop: (state: TurnWorldState) => boolean,
        runOptions?: TurnHarnessRunOptions,
        afterTick?: (state: TurnWorldState, world: InMemoryTurnWorld) => void
    ) => {
        while (true) {
            await runOneTick(runOptions);
            const state = world.getState();
            afterTick?.(state, world);
            if (shouldStop(state)) {
                break;
            }
        }
    };

    return {
        world,
        worldRef,
        reservedTurnStore,
        handler,
        processor,
        runOneTick,
        runUntil,
        getCollectedLogs: () => [...collectedLogs],
        getAndClearCollectedLogs: () => collectedLogs.splice(0, collectedLogs.length),
    };
};

export type DebugWatchTargets = {
    cityIds?: number[];
    nationIds?: number[];
    includeNationSummary?: boolean;
};

const toList = (value?: number[] | number): number[] => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'number') return [value];
    return [];
};

const formatCity = (city: ReturnType<InMemoryTurnWorld['getCityById']>) => {
    if (!city) return null;
    return {
        id: city.id,
        name: city.name,
        nationId: city.nationId,
        level: city.level,
        state: city.state,
        population: city.population,
        populationMax: city.populationMax,
        agriculture: city.agriculture,
        agricultureMax: city.agricultureMax,
        commerce: city.commerce,
        commerceMax: city.commerceMax,
        security: city.security,
        securityMax: city.securityMax,
        defence: city.defence,
        defenceMax: city.defenceMax,
        wall: city.wall,
        wallMax: city.wallMax,
        supplyState: city.supplyState,
        frontState: city.frontState,
        meta: city.meta,
    };
};

export const createWorldDebugger = (
    getWorld: () => InMemoryTurnWorld | null,
    watchTargets: DebugWatchTargets = {}
) => {
    const dumpWorldSummary = (label = 'WORLD') => {
        const world = getWorld();
        if (!world) {
            console.log(`[DEBUG] ${label} (no world)`);
            return;
        }
        const nations = world.listNations();
        const cities = world.listCities();
        const generals = world.listGenerals();
        const neutralCities = cities.filter((city) => city.nationId <= 0).length;
        const state = world.getState();
        console.log('[DEBUG] world summary', {
            label,
            year: state.currentYear,
            month: state.currentMonth,
            nations: nations.length,
            cities: cities.length,
            generals: generals.length,
            neutralCities,
        });
        if (watchTargets.includeNationSummary) {
            const nationSummaries = nations.map((nation) => {
                const cityCount = cities.filter((city) => city.nationId === nation.id).length;
                const generalCount = generals.filter((general) => general.nationId === nation.id).length;
                return {
                    id: nation.id,
                    name: nation.name,
                    level: nation.level,
                    typeCode: nation.typeCode,
                    capitalCityId: nation.capitalCityId,
                    chiefGeneralId: nation.chiefGeneralId,
                    gold: nation.gold,
                    rice: nation.rice,
                    power: nation.power,
                    cityCount,
                    generalCount,
                    meta: nation.meta,
                };
            });
            console.log('[DEBUG] nation summary', nationSummaries);
        }
    };

    const dumpCity = (cityId: number, label = 'CITY') => {
        const world = getWorld();
        if (!world) {
            console.log(`[DEBUG] ${label} (no world)`);
            return;
        }
        const city = world.getCityById(cityId);
        console.log('[DEBUG] city detail', { label, cityId, city: formatCity(city) });
    };

    const dumpNation = (nationId: number, label = 'NATION') => {
        const world = getWorld();
        if (!world) {
            console.log(`[DEBUG] ${label} (no world)`);
            return;
        }
        const nation = world.getNationById(nationId);
        if (!nation) {
            console.log('[DEBUG] nation detail', { label, nationId, nation: null });
            return;
        }
        const cities = world.listCities().filter((city) => city.nationId === nationId);
        const generals = world.listGenerals().filter((general) => general.nationId === nationId);
        console.log('[DEBUG] nation detail', {
            label,
            nationId,
            nation: {
                id: nation.id,
                name: nation.name,
                level: nation.level,
                typeCode: nation.typeCode,
                capitalCityId: nation.capitalCityId,
                chiefGeneralId: nation.chiefGeneralId,
                gold: nation.gold,
                rice: nation.rice,
                power: nation.power,
                meta: nation.meta,
            },
            cityCount: cities.length,
            generalCount: generals.length,
        });
    };

    const dumpWatched = (label = 'WATCH') => {
        const { cityIds, nationIds } = watchTargets;
        dumpWorldSummary(label);
        for (const id of toList(nationIds)) {
            dumpNation(id, label);
        }
        for (const id of toList(cityIds)) {
            dumpCity(id, label);
        }
    };

    return {
        dumpWorldSummary,
        dumpCity,
        dumpNation,
        dumpWatched,
    };
};
