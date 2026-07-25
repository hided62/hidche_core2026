import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { consumeEquippedItemCharge, getEquippedItemInstance } from './inventory.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { WarUnitCity, WarUnitGeneral, type WarUnit } from '@sammo-ts/logic/war/units.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'event_충차';

class EventRamConsumptionTrigger extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Pre + 200, BaseWarUnitTrigger.TYPE_CONSUMABLE_ITEM);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!(self instanceof WarUnitGeneral) || !(oppose instanceof WarUnitCity)) {
            return true;
        }
        if (self.hasActivatedSkillOnLog('충차공격') > 0) {
            return true;
        }
        const general = self.getGeneral();
        if (getEquippedItemInstance(general, 'item')?.itemKey !== ITEM_KEY) {
            return true;
        }

        self.activateSkill('충차공격', '아이템사용');
        self.getLogger().pushGeneralBattleDetailLog('<C>충차</>로 성벽을 공격합니다.');
        consumeEquippedItemCharge(general, 'item', ITEM_KEY, 2);
        return true;
    }
}

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '충차',
    name: '충차',
    info: '[전투] 성벽 공격 시 대미지 +50%, 2회용',
    slot: 'item',
    cost: 2000,
    buyable: true,
    consumable: true,
    initialCharges: 2,
    reqSecu: 3000,
    unique: false,
    getWarPowerMultiplier: (_context, _unit, oppose) => (oppose instanceof WarUnitCity ? [1.5, 1] : [1, 1]),
    getBattlePhaseTriggerList: (context) =>
        context.unit ? new WarTriggerCaller(new EventRamConsumptionTrigger(context.unit)) : null,
};
