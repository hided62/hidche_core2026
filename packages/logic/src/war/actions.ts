import type { RandUtil } from '@sammo-ts/common';

import type { City, General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { ActionLogger } from '@sammo-ts/logic/logging/actionLogger.js';
import type { WarStatBundleMap, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarUnit } from './units.js';
import { WarTriggerCaller } from './triggers.js';

export interface WarActionContext<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    general: General<TriggerState>;
    nation?: Nation | null;
    city?: City;
    log?: ActionLogger;
    rng?: RandUtil;
    unit?: WarUnit<TriggerState>;
}

export interface WarActionModule<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    getName?: (() => string) | undefined;
    getInfo?: (() => string) | undefined;

    getBattleInitTriggerList?: ((context: WarActionContext<TriggerState>) => WarTriggerCaller | null) | undefined;

    getBattlePhaseTriggerList?: ((context: WarActionContext<TriggerState>) => WarTriggerCaller | null) | undefined;

    onCalcStat?:
    | (<T extends WarStatName>(
        context: WarActionContext<TriggerState>,
        statName: T,
        value: WarStatBundleMap[T]['value'],
        aux?: WarStatBundleMap[T]['aux']
    ) => WarStatBundleMap[T]['return'])
    | undefined;

    onCalcOpposeStat?:
    | (<T extends WarStatName>(
        context: WarActionContext<TriggerState>,
        statName: T,
        value: WarStatBundleMap[T]['value'],
        aux?: WarStatBundleMap[T]['aux']
    ) => WarStatBundleMap[T]['return'])
    | undefined;

    getWarPowerMultiplier?:
    | ((
        context: WarActionContext<TriggerState>,
        unit: WarUnit<TriggerState>,
        oppose: WarUnit<TriggerState>
    ) => [number, number])
    | undefined;
}

export class WarActionPipeline<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    // 전투용 iAction 파이프라인: 스탯/트리거/전투력 보정 흐름을 순서대로 적용한다.
    private readonly modules: WarActionModule<TriggerState>[];

    constructor(modules: Array<WarActionModule<TriggerState> | null | undefined>) {
        this.modules = modules.filter(Boolean) as WarActionModule<TriggerState>[];
    }

    getBattleInitTriggerList(context: WarActionContext<TriggerState>): WarTriggerCaller {
        const caller = new WarTriggerCaller();
        for (const module of this.modules) {
            const triggers = module.getBattleInitTriggerList?.(context);
            if (triggers) {
                caller.merge(triggers);
            }
        }
        return caller;
    }

    getBattlePhaseTriggerList(context: WarActionContext<TriggerState>): WarTriggerCaller {
        const caller = new WarTriggerCaller();
        for (const module of this.modules) {
            const triggers = module.getBattlePhaseTriggerList?.(context);
            if (triggers) {
                caller.merge(triggers);
            }
        }
        return caller;
    }

    onCalcStat<T extends WarStatName>(
        context: WarActionContext<TriggerState>,
        statName: T,
        value: WarStatBundleMap[T]['value'],
        aux?: WarStatBundleMap[T]['aux']
    ): WarStatBundleMap[T]['return'] {
        let current = value;
        for (const module of this.modules) {
            if (!module.onCalcStat) {
                continue;
            }
            current = module.onCalcStat(context, statName, current as never, aux as never) as never;
        }
        return current;
    }

    onCalcOpposeStat<T extends WarStatName>(
        context: WarActionContext<TriggerState>,
        statName: T,
        value: WarStatBundleMap[T]['value'],
        aux?: WarStatBundleMap[T]['aux']
    ): WarStatBundleMap[T]['return'] {
        let current = value;
        for (const module of this.modules) {
            if (!module.onCalcOpposeStat) {
                continue;
            }
            current = module.onCalcOpposeStat(context, statName, current as never, aux as never) as never;
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
        for (const module of this.modules) {
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
