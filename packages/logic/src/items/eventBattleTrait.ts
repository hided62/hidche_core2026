import type { TraitModule } from '@sammo-ts/logic/actionModules/traits/types.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_의술발동, che_의술시도 } from '@sammo-ts/logic/war/triggers/che_의술.js';
import { che_저격발동, che_저격시도 } from '@sammo-ts/logic/war/triggers/che_저격.js';
import type { ItemModule } from './types.js';

export const createEventBattleTraitItemModule = (
    key: string,
    traitModule: TraitModule,
    overrides: Partial<
        Pick<ItemModule, 'rawName' | 'name' | 'info' | 'cost' | 'buyable' | 'consumable' | 'reqSecu'>
    > = {}
): ItemModule => {
    const itemModule: ItemModule = {
        key,
        rawName: overrides.rawName ?? '비급',
        name: overrides.name ?? `비급(${traitModule.name})`,
        info: overrides.info ?? traitModule.info,
        slot: 'item',
        cost: overrides.cost ?? 100,
        buyable: overrides.buyable ?? true,
        consumable: overrides.consumable ?? false,
        reqSecu: overrides.reqSecu ?? 3000,
        unique: false,
    };
    if (traitModule.getPreTurnExecuteTriggerList) {
        itemModule.getPreTurnExecuteTriggerList = traitModule.getPreTurnExecuteTriggerList;
    }
    if (traitModule.onCalcDomestic) {
        itemModule.onCalcDomestic = traitModule.onCalcDomestic;
    }
    if (traitModule.onCalcStat) {
        itemModule.onCalcStat = traitModule.onCalcStat;
    }
    if (traitModule.onCalcOpposeStat) {
        itemModule.onCalcOpposeStat = traitModule.onCalcOpposeStat;
    }
    if (traitModule.onCalcStrategic) {
        itemModule.onCalcStrategic = traitModule.onCalcStrategic;
    }
    if (traitModule.onCalcNationalIncome) {
        itemModule.onCalcNationalIncome = traitModule.onCalcNationalIncome;
    }
    if (traitModule.eventHandlers) {
        itemModule.eventHandlers = traitModule.eventHandlers;
    }
    if (traitModule.getBattleInitTriggerList) {
        itemModule.getBattleInitTriggerList = traitModule.getBattleInitTriggerList;
    }
    if (traitModule.getBattlePhaseTriggerList) {
        if (traitModule.key === 'che_저격') {
            itemModule.getBattlePhaseTriggerList = (context) =>
                context.unit
                    ? new WarTriggerCaller(
                          new che_저격시도(context.unit, BaseWarUnitTrigger.TYPE_ITEM, 0.5, 20, 40),
                          new che_저격발동(context.unit, BaseWarUnitTrigger.TYPE_ITEM)
                      )
                    : null;
        } else if (traitModule.key === 'che_의술') {
            itemModule.getBattlePhaseTriggerList = (context) =>
                context.unit
                    ? new WarTriggerCaller(
                          new che_의술시도(context.unit, BaseWarUnitTrigger.TYPE_ITEM),
                          new che_의술발동(context.unit)
                      )
                    : null;
        } else {
            itemModule.getBattlePhaseTriggerList = traitModule.getBattlePhaseTriggerList;
        }
    }
    if (traitModule.getWarPowerMultiplier) {
        itemModule.getWarPowerMultiplier =
            traitModule.key === 'che_무쌍'
                ? (context, unit, oppose) => {
                      const general =
                          'getGeneral' in unit && typeof (unit as { getGeneral?: unknown }).getGeneral === 'function'
                              ? (
                                    unit as typeof unit & {
                                        getGeneral: () => { role: { specialWar: string | null } };
                                    }
                                ).getGeneral()
                              : null;
                      return general?.role.specialWar === traitModule.key
                          ? [1, 1]
                          : traitModule.getWarPowerMultiplier!(context, unit, oppose);
                  }
                : traitModule.getWarPowerMultiplier;
    }
    return itemModule;
};
