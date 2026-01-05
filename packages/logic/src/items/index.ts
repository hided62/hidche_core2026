import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import { GeneralTriggerCaller, type GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type {
    GeneralStatName,
    TriggerActionPhase,
    TriggerActionType,
    TriggerDomesticActionType,
    TriggerDomesticVarType,
    TriggerNationalIncomeType,
    TriggerStrategicActionType,
    TriggerStrategicVarType,
    WarStatName,
} from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext, WarActionModule } from '@sammo-ts/logic/war/actions.js';
import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';
import type { ItemModule, ItemModuleExport } from './types.js';
import { listEquippedItemKeys } from './utils.js';

export const ITEM_KEYS = [
    'che_명마_06_흑색마',
    'che_무기_02_단궁',
    'che_서적_03_변도론',
    'che_치료_환약',
    'che_명마_12_사륜거',
    'che_무기_09_동호비궁',
    'che_서적_08_전론',
    'che_보물_도기',
] as const;

export type ItemKey = (typeof ITEM_KEYS)[number];

export type ItemImporter = () => Promise<ItemModuleExport>;

const defaultImporters: Record<ItemKey, ItemImporter> = {
    che_명마_06_흑색마: async () => import('./che_명마_06_흑색마.js'),
    che_무기_02_단궁: async () => import('./che_무기_02_단궁.js'),
    che_서적_03_변도론: async () => import('./che_서적_03_변도론.js'),
    che_치료_환약: async () => import('./che_치료_환약.js'),
    che_명마_12_사륜거: async () => import('./che_명마_12_사륜거.js'),
    che_무기_09_동호비궁: async () => import('./che_무기_09_동호비궁.js'),
    che_서적_08_전론: async () => import('./che_서적_08_전론.js'),
    che_보물_도기: async () => import('./che_보물_도기.js'),
};

export const isItemKey = (value: string): value is ItemKey => ITEM_KEYS.includes(value as ItemKey);

export class ItemLoader {
    private readonly cache = new Map<ItemKey, Promise<ItemModule>>();

    constructor(private readonly importers: Record<ItemKey, ItemImporter> = defaultImporters) {}

    async load(key: ItemKey): Promise<ItemModule> {
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown item key: ${key}`);
        }
        const loading = importer().then((module) => {
            if (!('itemModule' in module)) {
                throw new Error(`Missing itemModule for item: ${key}`);
            }
            const resolved = module.itemModule;
            if (resolved.key !== key) {
                throw new Error(`Item key mismatch: expected ${key}, got ${resolved.key}`);
            }
            return resolved;
        });
        this.cache.set(key, loading);
        return loading;
    }
}

export const loadItemModules = async (
    keys: ItemKey[],
    loader: ItemLoader = new ItemLoader()
): Promise<ItemModule[]> => {
    const modules: ItemModule[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        modules.push(await loader.load(key));
    }
    return modules;
};

export type ItemModuleRegistry<TriggerState extends GeneralTriggerState = GeneralTriggerState> = Map<
    string,
    ItemModule<TriggerState>
>;

export const createItemModuleRegistry = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    modules: ItemModule<TriggerState>[]
): ItemModuleRegistry<TriggerState> => {
    const registry: ItemModuleRegistry<TriggerState> = new Map();
    for (const module of modules) {
        registry.set(module.key, module);
    }
    return registry;
};

class ItemGeneralActionRouter<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionModule<TriggerState> {
    constructor(private readonly registry: ItemModuleRegistry<TriggerState>) {}

    private resolveModules(context: GeneralActionContext<TriggerState>): Array<ItemModule<TriggerState>> {
        const keys = listEquippedItemKeys(context.general);
        const modules: Array<ItemModule<TriggerState>> = [];
        for (const key of keys) {
            const module = this.registry.get(key);
            if (module) {
                modules.push(module);
            }
        }
        return modules;
    }

    getPreTurnExecuteTriggerList(
        context: GeneralActionContext<TriggerState>
    ): GeneralTriggerCaller<TriggerState> | null {
        const caller = new GeneralTriggerCaller<TriggerState>();
        for (const module of this.resolveModules(context)) {
            const triggers = module.getPreTurnExecuteTriggerList?.(context);
            if (triggers) {
                caller.merge(triggers);
            }
        }
        return caller.isEmpty() ? null : caller;
    }

    onCalcDomestic(
        context: GeneralActionContext<TriggerState>,
        turnType: TriggerDomesticActionType,
        varType: TriggerDomesticVarType,
        value: number,
        aux?: unknown
    ): number {
        let current = value;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcDomestic) {
                continue;
            }
            current = module.onCalcDomestic(context, turnType, varType, current, aux);
        }
        return current;
    }

    onCalcStat(
        context: GeneralActionContext<TriggerState>,
        statName: GeneralStatName,
        value: number,
        aux?: unknown
    ): number {
        let current = value;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcStat) {
                continue;
            }
            current = module.onCalcStat(context, statName, current, aux);
        }
        return current;
    }

    onCalcOpposeStat(
        context: GeneralActionContext<TriggerState>,
        statName: GeneralStatName,
        value: number,
        aux?: unknown
    ): number {
        let current = value;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcOpposeStat) {
                continue;
            }
            current = module.onCalcOpposeStat(context, statName, current, aux);
        }
        return current;
    }

    onCalcStrategic(
        context: GeneralActionContext<TriggerState>,
        turnType: TriggerStrategicActionType,
        varType: TriggerStrategicVarType,
        value: number
    ): number {
        let current = value;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcStrategic) {
                continue;
            }
            current = module.onCalcStrategic(context, turnType, varType, current);
        }
        return current;
    }

    onCalcNationalIncome(
        context: GeneralActionContext<TriggerState>,
        type: TriggerNationalIncomeType,
        amount: number
    ): number {
        let current = amount;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcNationalIncome) {
                continue;
            }
            current = module.onCalcNationalIncome(context, type, current);
        }
        return current;
    }

    onArbitraryAction(
        context: GeneralActionContext<TriggerState>,
        actionType: TriggerActionType,
        phase?: TriggerActionPhase | null,
        aux?: Record<string, unknown> | null
    ): Record<string, unknown> | null {
        let current = aux ?? null;
        for (const module of this.resolveModules(context)) {
            if (!module.onArbitraryAction) {
                continue;
            }
            const result = module.onArbitraryAction(context, actionType, phase, current);
            if (result !== undefined) {
                current = result;
            }
        }
        return current;
    }
}

class ItemWarActionRouter<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements WarActionModule<TriggerState> {
    constructor(private readonly registry: ItemModuleRegistry<TriggerState>) {}

    private resolveModules(context: WarActionContext<TriggerState>): Array<ItemModule<TriggerState>> {
        const keys = listEquippedItemKeys(context.general);
        const modules: Array<ItemModule<TriggerState>> = [];
        for (const key of keys) {
            const module = this.registry.get(key);
            if (module) {
                modules.push(module);
            }
        }
        return modules;
    }

    getBattleInitTriggerList(context: WarActionContext<TriggerState>): WarTriggerCaller | null {
        const caller = new WarTriggerCaller();
        for (const module of this.resolveModules(context)) {
            const triggers = module.getBattleInitTriggerList?.(context);
            if (triggers) {
                caller.merge(triggers);
            }
        }
        return caller.isEmpty() ? null : caller;
    }

    getBattlePhaseTriggerList(context: WarActionContext<TriggerState>): WarTriggerCaller | null {
        const caller = new WarTriggerCaller();
        for (const module of this.resolveModules(context)) {
            const triggers = module.getBattlePhaseTriggerList?.(context);
            if (triggers) {
                caller.merge(triggers);
            }
        }
        return caller.isEmpty() ? null : caller;
    }

    onCalcStat(
        context: WarActionContext<TriggerState>,
        statName: WarStatName,
        value: number | [number, number],
        aux?: unknown
    ): number | [number, number] {
        let current: number | [number, number] = value;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcStat) {
                continue;
            }
            current = module.onCalcStat(context, statName, current, aux);
        }
        return current;
    }

    onCalcOpposeStat(
        context: WarActionContext<TriggerState>,
        statName: WarStatName,
        value: number | [number, number],
        aux?: unknown
    ): number | [number, number] {
        let current: number | [number, number] = value;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcOpposeStat) {
                continue;
            }
            current = module.onCalcOpposeStat(context, statName, current, aux);
        }
        return current;
    }

    getWarPowerMultiplier(
        context: WarActionContext<TriggerState>,
        unit: WarUnit<TriggerState>,
        oppose: WarUnit<TriggerState>
    ): [number, number] {
        let attack = 1;
        let defence = 1;
        for (const module of this.resolveModules(context)) {
            if (!module.getWarPowerMultiplier) {
                continue;
            }
            const [attMul, defMul] = module.getWarPowerMultiplier(context, unit, oppose);
            attack *= attMul;
            defence *= defMul;
        }
        return [attack, defence];
    }
}

export const createItemActionModules = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    registry: ItemModuleRegistry<TriggerState>
): { general: GeneralActionModule<TriggerState>[]; war: WarActionModule<TriggerState>[] } => ({
    general: [new ItemGeneralActionRouter(registry)],
    war: [new ItemWarActionRouter(registry)],
});

export type { ItemModule, ItemModuleExport, ItemSlot } from './types.js';
export {
    canAcquireItem,
    isInventoryEnabled,
    listEquippedItemKeys,
    consumeItemRemain,
    getItemRemain,
    setItemRemain,
} from './utils.js';
