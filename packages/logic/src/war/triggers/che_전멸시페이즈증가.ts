import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

/**
 * ref che_전멸시페이즈증가.
 *
 * 이전 수비자를 격파한 공격자가 phase를 소비한 상태로 새 수비자
 * (phase 0)와 맞붙을 때 다음 phase 하나를 보너스로 얻습니다.
 */
export class che_전멸시페이즈증가 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Post + 800);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (self.getPhase() === 0 || oppose.getPhase() !== 0) {
            return true;
        }

        self.addBonusPhase(1);
        self.getLogger().pushGeneralBattleDetailLog('적군의 전멸에 <C>진격</>이 이어집니다!', LogFormat.PLAIN);
        oppose.getLogger().pushGeneralBattleDetailLog('아군의 전멸에 상대의 <R>진격</>이 이어집니다!', LogFormat.PLAIN);
        return true;
    }
}
