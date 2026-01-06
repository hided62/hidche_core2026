import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { WarActionModule } from '@sammo-ts/logic/war/actions.js';
import type { TraitSelection } from './requirements.js';

export type TraitKind = 'domestic' | 'war' | 'personality' | 'nation';

export interface TraitSpec {
    key: string;
    name: string;
    info: string;
    kind: TraitKind;
    selection?: TraitSelection;
}

export type TraitModule<TriggerState extends GeneralTriggerState = GeneralTriggerState> = TraitSpec &
    GeneralActionModule<TriggerState> &
    WarActionModule<TriggerState>;

export interface TraitModuleExport<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    traitModule: TraitModule<TriggerState>;
}

export interface TraitModuleRegistry<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    domestic: Map<string, TraitModule<TriggerState>>;
    war: Map<string, TraitModule<TriggerState>>;
    personality: Map<string, TraitModule<TriggerState>>;
    nation: Map<string, TraitModule<TriggerState>>;
}
