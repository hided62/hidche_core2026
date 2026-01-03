import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { WarActionModule } from '@sammo-ts/logic/war/actions.js';

export type SpecialActionKind = 'domestic' | 'war';

export interface SpecialActionSpec {
    key: string;
    name: string;
    info: string;
    kind: SpecialActionKind;
}

export type SpecialActionModule<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> = SpecialActionSpec &
    GeneralActionModule<TriggerState> &
    WarActionModule<TriggerState>;

export interface SpecialActionModuleExport<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    specialModule: SpecialActionModule<TriggerState>;
}

export interface SpecialActionModuleRegistry<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    domestic: Map<string, SpecialActionModule<TriggerState>>;
    war: Map<string, SpecialActionModule<TriggerState>>;
}
