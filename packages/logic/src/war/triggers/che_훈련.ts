import { BaseWarUnitTrigger } from '../triggers.js';
import type { WarUnit } from '../units.js';

export class che_훈련 extends BaseWarUnitTrigger {
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
