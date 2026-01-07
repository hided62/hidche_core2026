import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { WarUnitGeneral, type WarUnit } from '@sammo-ts/logic/war/units.js';
import type { WarTriggerModule } from './types.js';

// 의술: 치료 시도
export class che_의술시도 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Pre + 350);
    }

    protected actionWar(
        self: WarUnit,
        _oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!(self instanceof WarUnitGeneral)) {
            return true;
        }
        if (self.hasActivatedSkill('치료')) {
            return true;
        }
        if (self.hasActivatedSkill('치료불가')) {
            return true;
        }
        if (!self.rng.nextBool(0.4)) {
            return true;
        }

        self.activateSkill('치료');
        return true;
    }
}

// 의술: 치료 발동
export class che_의술발동 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Post + 550);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!self.hasActivatedSkill('치료')) {
            return true;
        }
        if (selfEnv['치료발동']) {
            return true;
        }
        selfEnv['치료발동'] = true;

        oppose.getLogger().pushGeneralBattleDetailLog('상대가 <R>치료</>했다!', LogFormat.PLAIN);
        self.getLogger().pushGeneralBattleDetailLog('<C>치료</>했다!', LogFormat.PLAIN);

        oppose.multiplyWarPowerMultiply(0.7);
        if (self instanceof WarUnitGeneral) {
            self.getGeneral().injury = 0;
        }

        this.processConsumableItem();

        return true;
    }
}

export const triggerModule: WarTriggerModule = {
    key: 'che_의술',
    name: '의술',
    info: '[전투] 페이즈마다 치료 발동(아군 피해 30% 감소, 부상 회복)',
    createTriggerList: (unit) => new WarTriggerCaller(new che_의술시도(unit), new che_의술발동(unit)),
};
