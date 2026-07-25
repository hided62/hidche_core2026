import type { GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { WarActionModule } from '@sammo-ts/logic/war/actions.js';
import type { CrewTypeDefinition, UnitSetDefinition } from '@sammo-ts/logic/world/types.js';

export interface CrewTypeActionModule {
    key: string;
    name: string;
    info: string;
    general?: GeneralActionModule;
    war?: WarActionModule;
}

export type CrewTypeActionRegistry = ReadonlyMap<string, CrewTypeActionModule>;

export interface CompiledCrewType {
    definition: CrewTypeDefinition;
    actions: readonly CrewTypeActionModule[];
}

export interface CrewTypeCatalog {
    unitSet: UnitSetDefinition;
    byId: ReadonlyMap<number, CompiledCrewType>;
    generalActionModule: GeneralActionModule;
    warActionModule: WarActionModule;
}
