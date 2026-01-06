import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { WarUnitGeneral, type WarUnit } from '@sammo-ts/logic/war/units.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_약탈_옥벽';

class CheTheftAttemptTrigger extends BaseWarUnitTrigger {
    private readonly ratio: number;
    private readonly theftRatio: number;

    constructor(unit: WarUnit, raiseType: number, ratio: number, theftRatio: number) {
        super(unit, TriggerPriority.Pre + 400, raiseType);
        this.ratio = ratio;
        this.theftRatio = theftRatio;
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!(self instanceof WarUnitGeneral)) {
            return true;
        }
        if (self.getPhase() !== 0 && oppose.getPhase() !== 0) {
            return true;
        }
        if (!(oppose instanceof WarUnitGeneral)) {
            return true;
        }
        if (self.hasActivatedSkill('약탈')) {
            return true;
        }
        if (self.hasActivatedSkill('약탈불가')) {
            return true;
        }
        if (!self.rng.nextBool(this.ratio)) {
            return true;
        }

        self.activateSkill('약탈');
        selfEnv['theftRatio'] = this.theftRatio;
        return true;
    }
}

class CheTheftActivateTrigger extends BaseWarUnitTrigger {
    constructor(unit: WarUnit, raiseType: number) {
        super(unit, TriggerPriority.Post + 350, raiseType);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!self.hasActivatedSkill('약탈')) {
            return true;
        }
        if (selfEnv['약탈발동']) {
            return true;
        }
        selfEnv['약탈발동'] = true;

        if (!(self instanceof WarUnitGeneral) || !(oppose instanceof WarUnitGeneral)) {
            return true;
        }

        const theftRatio = (selfEnv['theftRatio'] as number) ?? 0;
        const selfGeneral = self.getGeneral();
        const opposeGeneral = oppose.getGeneral();

        const theftGold = Math.floor(opposeGeneral.gold * theftRatio);
        const theftRice = Math.floor(opposeGeneral.rice * theftRatio);

        opposeGeneral.gold = Math.max(0, opposeGeneral.gold - theftGold);
        opposeGeneral.rice = Math.max(0, opposeGeneral.rice - theftRice);

        selfGeneral.gold += theftGold;
        selfGeneral.rice += theftRice;

        self.getLogger().pushGeneralActionLog('상대를 <C>약탈</>했다!', LogFormat.PLAIN);
        self.getLogger().pushGeneralBattleDetailLog(
            `상대에게서 금 ${theftGold.toLocaleString()}, 쌀 ${theftRice.toLocaleString()} 만큼을 <C>약탈</>했다!`,
            LogFormat.PLAIN
        );
        oppose.getLogger().pushGeneralActionLog('상대에게 <R>약탈</>당했다!', LogFormat.PLAIN);
        oppose
            .getLogger()
            .pushGeneralBattleDetailLog(
                `상대에게 금 ${theftGold.toLocaleString()}, 쌀 ${theftRice.toLocaleString()} 만큼을 <R>약탈</>당했다!`,
                LogFormat.PLAIN
            );

        this.processConsumableItem();
        return true;
    }
}

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '옥벽',
    name: '옥벽(약탈)',
    info: '[전투] 새로운 상대와 전투 시 20% 확률로 상대 금, 쌀 10% 약탈',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    getBattlePhaseTriggerList: (context) => {
        if (!context.unit) return null;
        return new WarTriggerCaller(
            new CheTheftAttemptTrigger(context.unit, BaseWarUnitTrigger.TYPE_ITEM, 0.2, 0.1),
            new CheTheftActivateTrigger(context.unit, BaseWarUnitTrigger.TYPE_ITEM)
        );
    },
};
