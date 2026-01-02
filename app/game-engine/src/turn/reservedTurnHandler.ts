import type {
    City,
    GeneralActionDefinition,
    LogEntryDraft,
    MapDefinition,
    Nation,
    ScenarioConfig,
    ScenarioMeta,
    Troop,
    TurnCommandProfile,
    UnitSetDefinition,
} from '@sammo-ts/logic';
import {
    DEFAULT_TURN_COMMAND_PROFILE,
    evaluateConstraints,
    resolveGeneralAction,
} from '@sammo-ts/logic';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';
import { LiteHashDRBG } from '@sammo-ts/common';

import type { ConstraintContext, StateView } from '@sammo-ts/logic';

import type { GeneralTurnHandler, GeneralTurnResult } from './inMemoryWorld.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { TurnGeneral, TurnWorldState } from './types.js';
import type { ReservedTurnEntry } from './reservedTurnStore.js';
import type { InMemoryReservedTurnStore } from './reservedTurnStore.js';
import {
    buildCommandEnv,
    buildReservedTurnDefinitions,
} from './reservedTurnCommands.js';
import type { ActionContextBase } from './reservedTurnActionContext.js';
import { buildActionContext } from './reservedTurnActionContext.js';

const DEFAULT_ACTION = '휴식';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> =>
    isRecord(value) ? value : {};

const resolveConstraintEnv = (
    world: TurnWorldState,
    scenarioMeta?: ScenarioMeta
): Record<string, unknown> => {
    const startYear =
        typeof scenarioMeta?.startYear === 'number'
            ? scenarioMeta.startYear
            : undefined;
    const relYear =
        typeof startYear === 'number'
            ? world.currentYear - startYear
            : undefined;

    return {
        currentYear: world.currentYear,
        currentMonth: world.currentMonth,
        year: world.currentYear,
        month: world.currentMonth,
        startYear,
        relYear,
    };
};

const buildSeedBase = (world: TurnWorldState): string => {
    const meta = asRecord(world.meta);
    const rawSeed = meta.hiddenSeed ?? meta.seed ?? world.id;
    return String(rawSeed);
};

const serializeSeed = (...values: Array<string | number>): string =>
    values
        .map((value) =>
            typeof value === 'string'
                ? `str(${value.length},${value})`
                : `int(${Math.floor(value)})`
        )
        .join('|');

class DeterministicRandom {
    constructor(private readonly rng: LiteHashDRBG) {}

    nextFloat(): number {
        return this.rng.nextFloat1();
    }

    nextBool(probability: number): boolean {
        if (probability >= 1) {
            return true;
        }
        if (probability <= 0) {
            return false;
        }
        return this.nextFloat() < probability;
    }

    nextInt(minInclusive: number, maxExclusive: number): number {
        const span = maxExclusive - minInclusive;
        if (span <= 1) {
            return minInclusive;
        }
        return minInclusive + this.rng.nextInt(span - 1);
    }
}

class WorldStateView implements StateView {
    constructor(
        private readonly world: InMemoryTurnWorld | null,
        private readonly env: Record<string, unknown>,
        private readonly args: Record<string, unknown>,
        private readonly overrides?: {
            general?: TurnGeneral;
            city?: City;
            nation?: Nation | null;
        }
    ) {}

    has(req: Parameters<StateView['has']>[0]): boolean {
        return this.get(req) !== null;
    }

    get(req: Parameters<StateView['get']>[0]): unknown | null {
        if (!this.world) {
            return null;
        }
        switch (req.kind) {
            case 'general':
                if (this.overrides?.general && this.overrides.general.id === req.id) {
                    return this.overrides.general;
                }
                return this.world.getGeneralById(req.id);
            case 'destGeneral':
                return this.world.getGeneralById(req.id);
            case 'city':
                if (this.overrides?.city && this.overrides.city.id === req.id) {
                    return this.overrides.city;
                }
                return this.world.getCityById(req.id);
            case 'destCity':
                return this.world.getCityById(req.id);
            case 'nation':
                if (this.overrides?.nation && this.overrides.nation.id === req.id) {
                    return this.overrides.nation;
                }
                return this.world.getNationById(req.id);
            case 'destNation':
                return this.world.getNationById(req.id);
            case 'diplomacy':
                return this.world.getDiplomacyEntry(
                    req.srcNationId,
                    req.destNationId
                );
            case 'arg':
                return this.args[req.key] ?? null;
            case 'env':
                return this.env[req.key] ?? null;
            default:
                return null;
        }
    }
}

 

const extractArgsRecord = (value: unknown): Record<string, unknown> =>
    isRecord(value) ? value : {};

 

const buildConstraintContext = (
    general: TurnGeneral,
    city: City | undefined,
    nation: Nation | null | undefined,
    args: Record<string, unknown>,
    env: Record<string, unknown>
): ConstraintContext => ({
    actorId: general.id,
    cityId: city?.id,
    nationId: nation?.id,
    args,
    env,
    mode: 'full',
});

const createActionLog = (message: string): LogEntryDraft => ({
    scope: LogScope.GENERAL,
    category: LogCategory.ACTION,
    format: LogFormat.MONTH,
    text: message,
});

const resolveDefinition = (
    actionKey: string,
    definitions: Map<string, GeneralActionDefinition>,
    fallback: GeneralActionDefinition
): GeneralActionDefinition => definitions.get(actionKey) ?? fallback;

export const createReservedTurnHandler = async (options: {
    reservedTurns: InMemoryReservedTurnStore;
    scenarioConfig: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    map?: MapDefinition;
    unitSet?: UnitSetDefinition;
    getWorld: () => InMemoryTurnWorld | null;
    commandProfile?: TurnCommandProfile;
}): Promise<GeneralTurnHandler> => {
    const env = buildCommandEnv(options.scenarioConfig, options.unitSet);
    const commandProfile =
        options.commandProfile ?? DEFAULT_TURN_COMMAND_PROFILE;
    const { general: generalDefinitions, nation: nationDefinitions } =
        await buildReservedTurnDefinitions({
            env,
            commandProfile,
            defaultActionKey: DEFAULT_ACTION,
        });
    const generalFallback = generalDefinitions.get(DEFAULT_ACTION)!;
    const nationFallback = nationDefinitions.get(DEFAULT_ACTION)!;

    let nextGeneralId: number | null = null;
    const createGeneralId = (): number => {
        if (nextGeneralId === null) {
            const world = options.getWorld();
            const ids = world ? world.listGenerals().map((general) => general.id) : [];
            nextGeneralId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
        }
        const result = nextGeneralId;
        nextGeneralId += 1;
        return result;
    };

    return {
        execute(context): GeneralTurnResult {
            const worldRef = options.getWorld();
            const constraintEnv = {
                ...resolveConstraintEnv(context.world, options.scenarioMeta),
                ...(options.map ? { map: options.map } : {}),
                ...(options.unitSet ? { unitSet: options.unitSet } : {}),
                cities: worldRef?.listCities() ?? [],
            };
            const logs: LogEntryDraft[] = [];
            const patches = {
                generals: [] as Array<{ id: number; patch: Partial<TurnGeneral> }>,
                cities: [] as Array<{ id: number; patch: Partial<City> }>,
                nations: [] as Array<{ id: number; patch: Partial<Nation> }>,
                troops: [] as Array<{ id: number; patch: Partial<Troop> }>,
            };
            const created: TurnGeneral[] = [];

            let currentGeneral = context.general;
            let currentCity = context.city;
            let currentNation = context.nation ?? null;

            const runAction = (
                definitionMap: Map<string, GeneralActionDefinition>,
                fallbackDefinition: GeneralActionDefinition,
                command: ReservedTurnEntry,
                applyNextTurnAt: boolean
            ): Date | undefined => {
                const resolvedDefinition = resolveDefinition(
                    command.action,
                    definitionMap,
                    fallbackDefinition
                );
                const rawArgs = extractArgsRecord(command.args);
                let parsedArgs = resolvedDefinition.parseArgs(rawArgs);
                let definition = resolvedDefinition;
                let actionArgs = parsedArgs ?? {};
                let actionKey = definition.key;

                if (parsedArgs === null) {
                    definition = fallbackDefinition;
                    actionArgs = definition.parseArgs({}) ?? {};
                    actionKey = definition.key;
                    logs.push(createActionLog('예약된 명령을 실행하지 못했습니다.'));
                }

                const constraintCtx = buildConstraintContext(
                    currentGeneral,
                    currentCity,
                    currentNation,
                    actionArgs as Record<string, unknown>,
                    constraintEnv
                );
                const view = new WorldStateView(
                    worldRef,
                    constraintEnv,
                    actionArgs as Record<string, unknown>,
                    {
                        general: currentGeneral,
                        city: currentCity,
                        nation: currentNation,
                    }
                );
                const constraints = definition.buildConstraints(
                    constraintCtx,
                    actionArgs
                );
                const result = evaluateConstraints(constraints, constraintCtx, view);
                if (result.kind !== 'allow') {
                    definition = fallbackDefinition;
                    actionArgs = definition.parseArgs({}) ?? {};
                    actionKey = definition.key;
                    const reason =
                        result.kind === 'deny'
                            ? result.reason
                            : '조건을 확인할 수 없습니다.';
                    logs.push(createActionLog(reason));
                }

                const seedBase = buildSeedBase(context.world);
                const buildRng = (key: string) => {
                    const rngSeed = serializeSeed(
                        seedBase,
                        key,
                        context.world.currentYear,
                        context.world.currentMonth,
                        currentGeneral.id
                    );
                    return new DeterministicRandom(new LiteHashDRBG(rngSeed));
                };

                const actionArgsRecord = extractArgsRecord(actionArgs);
                let baseContext: ActionContextBase = {
                    general: currentGeneral,
                    city: currentCity,
                    nation: currentNation,
                    rng: buildRng(actionKey),
                };
                let specificContext = buildActionContext(actionKey, baseContext, {
                    world: context.world,
                    scenarioMeta: options.scenarioMeta,
                    map: options.map,
                    unitSet: options.unitSet,
                    worldRef,
                    actionArgs: actionArgsRecord,
                    createGeneralId,
                });
                if (!specificContext && actionKey !== fallbackDefinition.key) {
                    definition = fallbackDefinition;
                    actionArgs = definition.parseArgs({}) ?? {};
                    actionKey = definition.key;
                    logs.push(createActionLog('예약된 명령을 실행하지 못했습니다.'));
                    baseContext = {
                        general: currentGeneral,
                        city: currentCity,
                        nation: currentNation,
                        rng: buildRng(actionKey),
                    };
                    specificContext = baseContext;
                }
                const actionContext = specificContext ?? baseContext;

                const resolution = resolveGeneralAction(
                    definition,
                    actionContext,
                    {
                        now: currentGeneral.turnTime,
                        schedule: context.schedule,
                    },
                    actionArgs
                );

                currentGeneral = resolution.general as TurnGeneral;
                currentCity = resolution.city ?? currentCity;
                currentNation = resolution.nation ?? currentNation;
                logs.push(...resolution.logs);

                if (worldRef && resolution.effects.length > 0) {
                    for (const effect of resolution.effects) {
                        if (effect.type !== 'diplomacy:patch') {
                            continue;
                        }
                        worldRef.applyDiplomacyPatch({
                            srcNationId: effect.srcNationId,
                            destNationId: effect.destNationId,
                            patch: effect.patch,
                        });
                    }
                }

                if (resolution.patches) {
                    patches.generals.push(
                        ...(resolution.patches.generals as Array<{
                            id: number;
                            patch: Partial<TurnGeneral>;
                        }>)
                    );
                    patches.cities.push(
                        ...(resolution.patches.cities as Array<{
                            id: number;
                            patch: Partial<City>;
                        }>)
                    );
                    patches.nations.push(
                        ...(resolution.patches.nations as Array<{
                            id: number;
                            patch: Partial<Nation>;
                        }>)
                    );
                }

                if (resolution.created?.generals) {
                    created.push(...(resolution.created.generals as TurnGeneral[]));
                }

                return applyNextTurnAt ? resolution.nextTurnAt : undefined;
            };

            if (currentNation && currentGeneral.officerLevel >= 5) {
                const nationCommand = options.reservedTurns.getNationTurn(
                    currentNation.id,
                    currentGeneral.officerLevel,
                    0
                );
                runAction(nationDefinitions, nationFallback, nationCommand, false);
                options.reservedTurns.shiftNationTurns(
                    currentNation.id,
                    currentGeneral.officerLevel,
                    -1
                );
            }

            const generalCommand = options.reservedTurns.getGeneralTurn(
                currentGeneral.id,
                0
            );
            const nextTurnAt = runAction(
                generalDefinitions,
                generalFallback,
                generalCommand,
                true
            );
            options.reservedTurns.shiftGeneralTurns(currentGeneral.id, -1);

            const result: GeneralTurnResult = {
                general: currentGeneral,
                city: currentCity,
                nation: currentNation,
                nextTurnAt,
                logs,
                patches,
                created: created.length > 0 ? { generals: created } : undefined,
            };

            return result;
        },
    };
};
