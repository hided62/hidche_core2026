import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

export class che_반계시도 extends BaseWarUnitTrigger {
    private readonly prob: number;

    constructor(unit: WarUnit, prob = 0.4) {
        super(unit, TriggerPriority.Pre + 200);
        this.prob = prob;
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!oppose.hasActivatedSkill('계략')) {
            return true;
        }
        if (self.hasActivatedSkill('반계불가')) {
            return true;
        }

        if (!self.rng.nextBool(this.prob)) {
            return true;
        }

        self.activateSkill('반계');
        oppose.deactivateSkill('계략');

        return true;
    }
}

export class che_반계발동 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Post + 150);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        opposeEnv: Record<string, unknown>
    ): boolean {
        if (!self.hasActivatedSkill('반계')) {
            return true;
        }

        const magicData = opposeEnv.magic as [string, number] | undefined;
        if (!magicData) {
            return true;
        }

        const [opposeMagic, damage] = magicData;

        self.getLogger().pushGeneralBattleDetailLog(
            `<C>반계</>로 상대의 <D>${opposeMagic}</>을 되돌렸다!`,
            LogFormat.PLAIN
        );
        oppose.getLogger().pushGeneralBattleDetailLog(`<D>${opposeMagic}</>을 <R>역으로</> 당했다!`, LogFormat.PLAIN);

        self.multiplyWarPowerMultiply(damage);

        return true;
    }
}
