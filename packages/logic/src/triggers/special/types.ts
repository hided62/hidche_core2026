import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { WarActionModule, WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';

export type TraitKind = 'domestic' | 'war' | 'personality';

export interface TraitSpec {
    key: string;
    name: string;
    info: string;
    kind: TraitKind;
}

export interface TraitOnCalcStat<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    (context: GeneralActionContext<TriggerState>, statName: GeneralStatName, value: number, aux?: unknown): number;
    (
        context: WarActionContext<TriggerState>,
        statName: WarStatName,
        value: number | [number, number],
        aux?: unknown
    ): number | [number, number];
}

export interface TraitOnCalcOpposeStat<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    (context: GeneralActionContext<TriggerState>, statName: GeneralStatName, value: number, aux?: unknown): number;
    (
        context: WarActionContext<TriggerState>,
        statName: WarStatName,
        value: number | [number, number],
        aux?: unknown
    ): number | [number, number];
}

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
