import type { TraitModule } from '@sammo-ts/logic/actionModules/traits/types.js';
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
        itemModule.getBattlePhaseTriggerList = traitModule.getBattlePhaseTriggerList;
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
