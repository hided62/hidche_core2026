import { actionModule as castleFirst } from './actions/che_성벽선제.js';
import type { CrewTypeActionModule, CrewTypeActionRegistry } from './types.js';

export const CREW_TYPE_ACTION_KEYS = ['che_성벽선제'] as const;

export const createCrewTypeActionRegistry = (
    modules: readonly CrewTypeActionModule[] = [castleFirst]
): CrewTypeActionRegistry => new Map(modules.map((module) => [module.key, module]));
