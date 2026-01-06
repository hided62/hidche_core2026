import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { WarUnitGeneral, type WarUnit } from '@sammo-ts/logic/war/units.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_저지_삼황내문';

class CheHaltTrigger extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Post);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!self.hasActivatedSkill('저지')) {
            return true;
        }

        if (selfEnv['저지발동']) {
            return true;
        }
        selfEnv['저지발동'] = true;

        self.addPhase(-1);
        oppose.addPhase(-1);
        if (self.getPhase() < self.getMaxPhase()) {
            oppose.addBonusPhase(-1);
        }

        self.getLogger().pushGeneralBattleDetailLog('상대를 <C>저지</>했다!', LogFormat.PLAIN);
        oppose.getLogger().pushGeneralBattleDetailLog('<R>저지</>당했다!', LogFormat.PLAIN);

        const calcDamage = oppose.getWarPower() * 0.9;
        if (self instanceof WarUnitGeneral) {
            self.addDex(oppose.getCrewType(), oppose.getWarPower() * 0.9);
            self.addDex(self.getCrewType(), calcDamage);

            self.addLevelExp(calcDamage / 50);
            let rice = self.calcRiceConsumption(calcDamage);
            rice *= 0.25;
            const general = self.getGeneral();
            general.rice = Math.max(0, general.rice - rice);
        }

        self.setWarPowerMultiply(0);
        oppose.setWarPowerMultiply(0);

        return false;
    }
}

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '삼황내문',
    name: '삼황내문(저지)',
    info: '[전투] 수비 시 첫 페이즈 저지, 50% 확률로 2 페이즈 저지',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    getBattlePhaseTriggerList: (context) => {
        const unit = context.unit;
        if (!unit || unit.isAttacker()) {
            return null;
        }

        if (unit.getPhase() > 0) {
            return null;
        }
        const haltCount = unit.hasActivatedSkillOnLog('저지');
        if (haltCount >= 2) {
            return null;
        }
        if (haltCount === 1 && unit.getPhase() === 0 && !unit.rng.nextBool(0.5)) {
            return null;
        }

        return new WarTriggerCaller(
            new (class extends BaseWarUnitTrigger {
                constructor(u: WarUnit) {
                    super(u, TriggerPriority.Pre);
                }
                protected actionWar(u: WarUnit): boolean {
                    u.activateSkill('특수', '저지');
                    return true;
                }
            })(unit),
            new CheHaltTrigger(unit)
        );
    },
};
