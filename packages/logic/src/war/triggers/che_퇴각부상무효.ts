import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import { WarUnitGeneral, type WarUnit } from '@sammo-ts/logic/war/units.js';

// 전투 종료 부상을 무효화하는 상태를 부여한다.
export class che_퇴각부상무효 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Begin + 300);
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
        self.activateSkill('퇴각부상무효');
        return true;
    }
}
