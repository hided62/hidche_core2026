import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { getEquippedItemInstance } from './inventory.js';
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
        if (self.hasActivatedSkillOnLog('충차공격') > 0 && self.getPhase() === self.getMaxPhase() - 1) {
            if (self instanceof WarUnitGeneral) {
                const equipped = getEquippedItemInstance(self.getGeneral(), 'item');
                if (equipped?.itemKey === ITEM_KEY && (equipped.state.charges ?? 0) <= 0) {
                    this.processConsumableItem();
                }
            }
            return true;
        }
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

        self.getLogger().pushGeneralBattleDetailLog('<C>충차</>로 성벽을 공격합니다.');
        self.activateSkill('충차공격');
        const equipped = getEquippedItemInstance(general, 'item');
        if (equipped?.itemKey === ITEM_KEY) {
            const remaining = equipped.state.charges ?? 2;
            // Ref decrements the purchase-time remain값 at first city contact,
            // but only deletes the item in the last battle phase.
            equipped.state.charges = remaining - 1;
        }
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
