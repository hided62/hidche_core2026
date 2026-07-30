import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import { dispatchGeneralActionModuleEvent, type GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';
import {
    type GeneralActionEvent,
    type GeneralActionEventContext,
    type GeneralActionEventType,
} from '@sammo-ts/logic/actionModules/events.js';
import type {
    GeneralStatName,
    TriggerDomesticActionType,
    TriggerDomesticVarType,
    TriggerNationalIncomeType,
    TriggerStrategicActionType,
    TriggerStrategicVarType,
    WarStatName,
} from '@sammo-ts/logic/actionModules/types.js';
import type { WarActionContext, WarActionModule } from '@sammo-ts/logic/war/actions.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';
import type { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { TraitCatalog, TraitKind, TraitModule } from './types.js';

const resolveTraitKey = (
    context: {
        general: {
            role: {
                personality: string | null;
                specialDomestic: string | null;
                specialWar: string | null;
            };
        };
        nation?: { typeCode: string } | null;
    },
    kind: TraitKind
): string | null => {
    if (kind === 'domestic') {
        return context.general.role.specialDomestic;
    }
    if (kind === 'war') {
        return context.general.role.specialWar;
    }
    if (kind === 'nation') {
        return context.nation?.typeCode ?? null;
    }
    return context.general.role.personality;
};

const resolveModule = <TriggerState extends GeneralTriggerState>(
    catalog: TraitCatalog<TriggerState>,
    kind: TraitKind,
    key: string | null
): TraitModule<TriggerState> | null => {
    if (!key) {
        return null;
    }
    let bucket: Map<string, TraitModule<TriggerState>>;
    if (kind === 'domestic') {
        bucket = catalog.domestic;
    } else if (kind === 'war') {
        bucket = catalog.war;
    } else if (kind === 'nation') {
        bucket = catalog.nation;
    } else {
        bucket = catalog.personality;
    }
    return bucket.get(key) ?? null;
};

// General 파이프라인에서 특성(특기/성격) 모듈을 선택해 위임하는 라우터.
export class TraitGeneralActionRouter<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    constructor(
        private readonly kind: TraitKind,
        private readonly catalog: TraitCatalog<TriggerState>
    ) {}

    private getModule(context: GeneralActionContext<TriggerState>): TraitModule<TriggerState> | null {
        const key = resolveTraitKey(context, this.kind);
        return resolveModule(this.catalog, this.kind, key);
    }

    getPreTurnExecuteTriggerList(context: GeneralActionContext<TriggerState>) {
        const module = this.getModule(context);
        return module?.getPreTurnExecuteTriggerList?.(context) ?? null;
    }

    onCalcDomestic(
        context: GeneralActionContext<TriggerState>,
        turnType: TriggerDomesticActionType,
        varType: TriggerDomesticVarType,
        value: number,
        aux?: unknown
    ): number {
        const module = this.getModule(context);
        return module?.onCalcDomestic?.(context, turnType, varType, value, aux) ?? value;
    }

    onCalcStat(
        context: GeneralActionContext<TriggerState>,
        statName: GeneralStatName,
        value: number,
        aux?: unknown
    ): number {
        const module = this.getModule(context);
        return module?.onCalcStat?.(context, statName, value, aux) ?? value;
    }

    onCalcOpposeStat(
        context: GeneralActionContext<TriggerState>,
        statName: GeneralStatName,
        value: number,
        aux?: unknown
    ): number {
        const module = this.getModule(context);
        return module?.onCalcOpposeStat?.(context, statName, value, aux) ?? value;
    }

    onCalcStrategic(
        context: GeneralActionContext<TriggerState>,
        turnType: TriggerStrategicActionType,
        varType: TriggerStrategicVarType,
        value: number
    ): number {
        const module = this.getModule(context);
        return module?.onCalcStrategic?.(context, turnType, varType, value) ?? value;
    }

    onCalcNationalIncome(
        context: GeneralActionContext<TriggerState>,
        type: TriggerNationalIncomeType,
        amount: number
    ): number {
        const module = this.getModule(context);
        return module?.onCalcNationalIncome?.(context, type, amount) ?? amount;
    }

    handleEvent<K extends GeneralActionEventType>(
        context: GeneralActionEventContext<K, TriggerState>,
        event: GeneralActionEvent<K, TriggerState>
    ): GeneralActionEvent<K, TriggerState> {
        const module = this.getModule(context);
        if (!module) {
            return event;
        }
        return dispatchGeneralActionModuleEvent(module, context, event);
    }
}

// 전투 파이프라인에서 특성(특기/성격) 모듈을 선택해 위임하는 라우터.
export class TraitWarActionRouter<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements WarActionModule<TriggerState> {
    constructor(
        private readonly kind: TraitKind,
        private readonly catalog: TraitCatalog<TriggerState>
    ) {}

    private getModule(context: WarActionContext<TriggerState>): TraitModule<TriggerState> | null {
        const key = resolveTraitKey(context, this.kind);
        return resolveModule(this.catalog, this.kind, key);
    }

    getBattleInitTriggerList(context: WarActionContext<TriggerState>): WarTriggerCaller | null {
        const module = this.getModule(context);
        return module?.getBattleInitTriggerList?.(context) ?? null;
    }

    getBattlePhaseTriggerList(context: WarActionContext<TriggerState>): WarTriggerCaller | null {
        const module = this.getModule(context);
        return module?.getBattlePhaseTriggerList?.(context) ?? null;
    }

    onCalcStat(
        context: WarActionContext<TriggerState>,
        statName: WarStatName,
        value: number | [number, number],
        aux?: unknown
    ): number | [number, number] {
        const module = this.getModule(context);
        return module?.onCalcStat?.(context, statName, value, aux) ?? value;
    }

    onCalcOpposeStat(
        context: WarActionContext<TriggerState>,
        statName: WarStatName,
        value: number | [number, number],
        aux?: unknown
    ): number | [number, number] {
        const module = this.getModule(context);
        return module?.onCalcOpposeStat?.(context, statName, value, aux) ?? value;
    }

    getWarPowerMultiplier(
        context: WarActionContext<TriggerState>,
        unit: WarUnit<TriggerState>,
        oppose: WarUnit<TriggerState>
    ): [number, number] {
        const module = this.getModule(context);
        return module?.getWarPowerMultiplier?.(context, unit, oppose) ?? [1, 1];
    }
}

export interface TraitModuleSet<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    general: ReadonlyArray<GeneralActionModule<TriggerState>>;
    war: WarActionModule<TriggerState>[];
}

export const createTraitCatalog = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(options: {
    domestic?: TraitModule<TriggerState>[];
    war?: TraitModule<TriggerState>[];
    personality?: TraitModule<TriggerState>[];
    nation?: TraitModule<TriggerState>[];
}): TraitCatalog<TriggerState> => {
    const domestic = new Map<string, TraitModule<TriggerState>>();
    const war = new Map<string, TraitModule<TriggerState>>();
    const personality = new Map<string, TraitModule<TriggerState>>();
    const nation = new Map<string, TraitModule<TriggerState>>();

    const insert = (
        bucket: Map<string, TraitModule<TriggerState>>,
        kind: TraitKind,
        module: TraitModule<TriggerState>
    ): void => {
        if (module.kind !== kind) {
            throw new Error(`Trait ${module.key} declared kind ${module.kind}, expected ${kind}`);
        }
        if (bucket.has(module.key)) {
            throw new Error(`Duplicate ${kind} trait key: ${module.key}`);
        }
        bucket.set(module.key, module);
    };

    for (const module of options.domestic ?? []) {
        insert(domestic, 'domestic', module);
    }
    for (const module of options.war ?? []) {
        insert(war, 'war', module);
    }
    for (const module of options.personality ?? []) {
        insert(personality, 'personality', module);
    }
    for (const module of options.nation ?? []) {
        insert(nation, 'nation', module);
    }

    return { domestic, war, personality, nation };
};

// 특성 레지스트리를 General/전투 파이프라인용 모듈 목록으로 변환한다.
export const createTraitModules = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    catalog: TraitCatalog<TriggerState>
): TraitModuleSet<TriggerState> => ({
    general: [
        new TraitGeneralActionRouter<TriggerState>('domestic', catalog),
        new TraitGeneralActionRouter<TriggerState>('war', catalog),
        new TraitGeneralActionRouter<TriggerState>('personality', catalog),
        new TraitGeneralActionRouter<TriggerState>('nation', catalog),
    ],
    war: [
        new TraitWarActionRouter<TriggerState>('domestic', catalog),
        new TraitWarActionRouter<TriggerState>('war', catalog),
        new TraitWarActionRouter<TriggerState>('personality', catalog),
        new TraitWarActionRouter<TriggerState>('nation', catalog),
    ],
});
