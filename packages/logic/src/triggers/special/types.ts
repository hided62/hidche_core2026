import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { WarActionModule } from '@sammo-ts/logic/war/actions.js';

export type TraitKind = 'domestic' | 'war' | 'personality';

export interface TraitSpec {
    key: string;
    name: string;
    info: string;
    kind: TraitKind;
}

import type { TraitOnCalcStat, TraitOnCalcOpposeStat, OnCalcStatParams } from '../types.js';
export type { TraitOnCalcStat, TraitOnCalcOpposeStat, OnCalcStatParams };

export type TraitModule<TriggerState extends GeneralTriggerState = GeneralTriggerState> = TraitSpec &
    Omit<GeneralActionModule<TriggerState>, 'onCalcStat' | 'onCalcOpposeStat'> &
    Omit<WarActionModule<TriggerState>, 'onCalcStat' | 'onCalcOpposeStat'> & {
        onCalcStat?: TraitOnCalcStat<TriggerState> | undefined;
        onCalcOpposeStat?: TraitOnCalcOpposeStat<TriggerState> | undefined;
    };

export interface TraitModuleExport<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    traitModule: TraitModule<TriggerState>;
}

export interface TraitModuleRegistry<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    domestic: Map<string, TraitModule<TriggerState>>;
    war: Map<string, TraitModule<TriggerState>>;
    personality: Map<string, TraitModule<TriggerState>>;
}
