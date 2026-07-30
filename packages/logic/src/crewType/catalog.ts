import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import { GeneralTriggerCaller } from '@sammo-ts/logic/triggers/general.js';
import { dispatchGeneralActionModuleEvent, type GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';
import {
    type GeneralActionEvent,
    type GeneralActionEventContext,
    type GeneralActionEventType,
} from '@sammo-ts/logic/actionModules/events.js';
import type { WarActionContext, WarActionModule } from '@sammo-ts/logic/war/actions.js';
import { WarTriggerCaller, type WarTriggerRegistry } from '@sammo-ts/logic/war/triggers.js';
import type { CrewTypeDefinition, CrewTypeRequirement, UnitSetDefinition } from '@sammo-ts/logic/world/types.js';

import { createCrewTypeActionRegistry } from './registry.js';
import type { CompiledCrewType, CrewTypeActionModule, CrewTypeActionRegistry, CrewTypeCatalog } from './types.js';

const crewTypeWarActionRouters = new WeakSet<object>();

const SUPPORTED_REQUIREMENTS = new Set([
    'ReqTech',
    'ReqRegions',
    'ReqCities',
    'ReqCitiesWithCityLevel',
    'ReqHighLevelCities',
    'ReqNationAux',
    'ReqMinRelYear',
    'ReqChief',
    'ReqNotChief',
    'Impossible',
]);

const validateRequirement = (
    unitSet: UnitSetDefinition,
    crewType: CrewTypeDefinition,
    requirement: CrewTypeRequirement
): void => {
    if (!SUPPORTED_REQUIREMENTS.has(requirement.type)) {
        throw new Error(`Unknown crew type requirement in ${unitSet.id}/${crewType.id}: ${requirement.type}`);
    }
};

const validateCoefficientKeys = (
    unitSet: UnitSetDefinition,
    crewType: CrewTypeDefinition,
    field: 'attackCoef' | 'defenceCoef',
    crewTypeIds: ReadonlySet<number>,
    armTypes: ReadonlySet<number>
): void => {
    for (const rawKey of Object.keys(crewType[field])) {
        const key = Number(rawKey);
        if (!Number.isInteger(key) || (!crewTypeIds.has(key) && !armTypes.has(key))) {
            throw new Error(`Invalid ${field} key in ${unitSet.id}/${crewType.id}: ${rawKey}`);
        }
    }
};

const compileDefinitions = (
    unitSet: UnitSetDefinition,
    actionRegistry: CrewTypeActionRegistry,
    triggerRegistry: WarTriggerRegistry
): Map<number, CompiledCrewType> => {
    const definitions = unitSet.crewTypes ?? [];
    if (definitions.length === 0) {
        throw new Error(`Unit set has no crew types: ${unitSet.id}`);
    }

    const crewTypeIds = new Set<number>();
    const crewTypeNames = new Set<string>();
    const armTypes = new Set(definitions.map((crewType) => crewType.armType));

    for (const crewType of definitions) {
        if (crewTypeIds.has(crewType.id)) {
            throw new Error(`Duplicate crew type id in ${unitSet.id}: ${crewType.id}`);
        }
        if (crewTypeNames.has(crewType.name)) {
            throw new Error(`Duplicate crew type name in ${unitSet.id}: ${crewType.name}`);
        }
        crewTypeIds.add(crewType.id);
        crewTypeNames.add(crewType.name);
    }

    const compiled = new Map<number, CompiledCrewType>();
    for (const crewType of definitions) {
        for (const requirement of crewType.requirements) {
            validateRequirement(unitSet, crewType, requirement);
        }
        validateCoefficientKeys(unitSet, crewType, 'attackCoef', crewTypeIds, armTypes);
        validateCoefficientKeys(unitSet, crewType, 'defenceCoef', crewTypeIds, armTypes);

        const actions: CrewTypeActionModule[] = [];
        for (const key of crewType.iActionList ?? []) {
            const action = actionRegistry.get(key);
            if (!action) {
                throw new Error(`Unknown crew type action in ${unitSet.id}/${crewType.id}: ${key}`);
            }
            actions.push(action);
        }

        for (const key of [...(crewType.initSkillTrigger ?? []), ...(crewType.phaseSkillTrigger ?? [])]) {
            if (!triggerRegistry[key]) {
                throw new Error(`Unknown crew type war trigger in ${unitSet.id}/${crewType.id}: ${key}`);
            }
        }

        compiled.set(crewType.id, { definition: crewType, actions });
    }
    return compiled;
};

const createGeneralActionRouter = <TriggerState extends GeneralTriggerState>(
    byId: ReadonlyMap<number, CompiledCrewType>
): GeneralActionModule<TriggerState> => {
    const modules = (context: GeneralActionContext<TriggerState>) =>
        (byId.get(context.general.crewTypeId)?.actions ?? [])
            .map((action) => action.general as GeneralActionModule<TriggerState> | undefined)
            .filter((action): action is GeneralActionModule<TriggerState> => action !== undefined);
    const handleEvent = <K extends GeneralActionEventType>(
        context: GeneralActionEventContext<K, TriggerState>,
        event: GeneralActionEvent<K, TriggerState>
    ): GeneralActionEvent<K, TriggerState> => {
        let current = event;
        for (const module of modules(context)) {
            current = dispatchGeneralActionModuleEvent(module, context, current);
        }
        return current;
    };

    return {
        getPreTurnExecuteTriggerList: (context) => {
            const caller = new GeneralTriggerCaller<TriggerState>();
            for (const module of modules(context)) {
                caller.merge(module.getPreTurnExecuteTriggerList?.(context));
            }
            return caller;
        },
        onCalcDomestic: (context, turnType, varType, value, aux) => {
            let current = value;
            for (const module of modules(context)) {
                current = module.onCalcDomestic?.(context, turnType, varType, current, aux) ?? current;
            }
            return current;
        },
        onCalcStat: (context, statName, value, aux) => {
            let current = value;
            for (const module of modules(context)) {
                current = module.onCalcStat?.(context, statName, current, aux) ?? current;
            }
            return current;
        },
        onCalcOpposeStat: (context, statName, value, aux) => {
            let current = value;
            for (const module of modules(context)) {
                current = module.onCalcOpposeStat?.(context, statName, current, aux) ?? current;
            }
            return current;
        },
        onCalcStrategic: (context, turnType, varType, value) => {
            let current = value;
            for (const module of modules(context)) {
                current = module.onCalcStrategic?.(context, turnType, varType, current) ?? current;
            }
            return current;
        },
        onCalcNationalIncome: (context, type, amount) => {
            let current = amount;
            for (const module of modules(context)) {
                current = module.onCalcNationalIncome?.(context, type, current) ?? current;
            }
            return current;
        },
        handleEvent,
    } satisfies GeneralActionModule<TriggerState>;
};

const createWarActionRouter = <TriggerState extends GeneralTriggerState>(
    byId: ReadonlyMap<number, CompiledCrewType>,
    triggerRegistry: WarTriggerRegistry
): WarActionModule<TriggerState> => {
    const compiled = (context: WarActionContext<TriggerState>) => byId.get(context.general.crewTypeId);
    const modules = (context: WarActionContext<TriggerState>) =>
        (compiled(context)?.actions ?? [])
            .map((action) => action.war as WarActionModule<TriggerState> | undefined)
            .filter((action): action is WarActionModule<TriggerState> => action !== undefined);
    const appendDefinitionTriggers = (
        caller: WarTriggerCaller,
        context: WarActionContext<TriggerState>,
        keys: readonly string[]
    ): void => {
        if (!context.unit) {
            if (keys.length > 0) {
                throw new Error('Crew type war triggers require a battle unit context');
            }
            return;
        }
        for (const key of keys) {
            const trigger = triggerRegistry[key]?.(context.unit);
            if (!trigger) {
                throw new Error(`Unknown crew type war trigger: ${key}`);
            }
            if (trigger instanceof WarTriggerCaller) {
                caller.merge(trigger);
            } else {
                caller.append(trigger);
            }
        }
    };

    const router = {
        getBattleInitTriggerList: (context) => {
            const caller = new WarTriggerCaller();
            appendDefinitionTriggers(caller, context, compiled(context)?.definition.initSkillTrigger ?? []);
            for (const module of modules(context)) {
                caller.merge(module.getBattleInitTriggerList?.(context));
            }
            return caller;
        },
        getBattlePhaseTriggerList: (context) => {
            const caller = new WarTriggerCaller();
            appendDefinitionTriggers(caller, context, compiled(context)?.definition.phaseSkillTrigger ?? []);
            for (const module of modules(context)) {
                caller.merge(module.getBattlePhaseTriggerList?.(context));
            }
            return caller;
        },
        onCalcStat: (context, statName, value, aux) => {
            let current = value;
            for (const module of modules(context)) {
                current = module.onCalcStat?.(context, statName, current, aux) ?? current;
            }
            return current;
        },
        onCalcOpposeStat: (context, statName, value, aux) => {
            let current = value;
            for (const module of modules(context)) {
                current = module.onCalcOpposeStat?.(context, statName, current, aux) ?? current;
            }
            return current;
        },
        getWarPowerMultiplier: (context, unit, oppose) => {
            let attack = 1;
            let defence = 1;
            for (const module of modules(context)) {
                const [attackMultiplier, defenceMultiplier] = module.getWarPowerMultiplier?.(context, unit, oppose) ?? [
                    1, 1,
                ];
                attack *= attackMultiplier;
                defence *= defenceMultiplier;
            }
            return [attack, defence];
        },
    } satisfies WarActionModule<TriggerState>;
    crewTypeWarActionRouters.add(router);
    return router;
};

export const isCrewTypeWarActionRouter = <TriggerState extends GeneralTriggerState>(
    module: WarActionModule<TriggerState>
): boolean => crewTypeWarActionRouters.has(module);

export const compileCrewTypeCatalog = (
    unitSet: UnitSetDefinition,
    triggerRegistry: WarTriggerRegistry,
    actionRegistry: CrewTypeActionRegistry = createCrewTypeActionRegistry()
): CrewTypeCatalog => {
    const byId = compileDefinitions(unitSet, actionRegistry, triggerRegistry);
    return {
        unitSet,
        byId,
        generalActionModule: createGeneralActionRouter(byId),
        warActionModule: createWarActionRouter(byId, triggerRegistry),
    };
};
