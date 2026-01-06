import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_훈련_청주';

class CheTrainIncreaseTrigger extends BaseWarUnitTrigger {
    private readonly amount: number;

    constructor(unit: WarUnit, raiseType: number, amount: number) {
        super(unit, 0, raiseType);
        this.amount = amount;
    }

    protected actionWar(self: WarUnit): boolean {
        self.addTrain(this.amount);
        this.processConsumableItem();
        return true;
    }
}

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '청주',
    name: '청주(훈련)',
    info: '[전투] 훈련 +40(한도 내). 1회용',
    slot: 'item',
    cost: 1000,
    buyable: true,
    consumable: true,
    reqSecu: 1000,
    unique: false,
    getBattleInitTriggerList: (context) => {
        if (!context.unit) return null;
        return new WarTriggerCaller(
            new CheTrainIncreaseTrigger(context.unit, BaseWarUnitTrigger.TYPE_CONSUMABLE_ITEM, 40)
        );
    },
};
