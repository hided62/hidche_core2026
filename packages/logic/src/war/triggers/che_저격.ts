import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import { WarUnitGeneral, type WarUnit } from '@sammo-ts/logic/war/units.js';
import { clamp } from '@sammo-ts/logic/war/utils.js';

// 저격 시도 트리거: 전투 시작 타이밍에 확률 체크.
export class che_저격시도 extends BaseWarUnitTrigger {
    private readonly ratio: number;
    private readonly woundMin: number;
    private readonly woundMax: number;
    private readonly addAtmos: number;

    constructor(unit: WarUnit, raiseType: number, ratio: number, woundMin: number, woundMax: number, addAtmos = 20) {
        super(unit, TriggerPriority.Pre + 100, raiseType);
        this.ratio = ratio;
        this.woundMin = woundMin;
        this.woundMax = woundMax;
        this.addAtmos = addAtmos;
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
        if (oppose.getPhase() < 0) {
            return true;
        }
        if (self.hasActivatedSkill('저격')) {
            return true;
        }
        if (self.hasActivatedSkill('저격불가')) {
            return true;
        }
        if (!self.rng.nextBool(this.ratio)) {
            return true;
        }

        self.activateSkill('저격');
        selfEnv['저격발동자'] = this.raiseType;
        selfEnv['woundMin'] = this.woundMin;
        selfEnv['woundMax'] = this.woundMax;
        selfEnv['addAtmos'] = this.addAtmos;
        return true;
    }
}

// 저격 발동 트리거: 성공 시 사기 보정과 부상 판정.
export class che_저격발동 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit, raiseType: number) {
        super(unit, TriggerPriority.Post + 100, raiseType);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!self.hasActivatedSkill('저격')) {
            return true;
        }
        if ((selfEnv['저격발동자'] ?? -1) !== this.raiseType) {
            return true;
        }
        if (selfEnv['저격발동']) {
            return true;
        }
        selfEnv['저격발동'] = true;

        if (oppose instanceof WarUnitGeneral) {
            self.getLogger().pushGeneralActionLog('상대를 <C>저격</>했다!', LogFormat.PLAIN);
            self.getLogger().pushGeneralBattleDetailLog('상대를 <C>저격</>했다!', LogFormat.PLAIN);
            oppose.getLogger().pushGeneralActionLog('상대에게 <R>저격</>당했다!', LogFormat.PLAIN);
            oppose.getLogger().pushGeneralBattleDetailLog('상대에게 <R>저격</>당했다!', LogFormat.PLAIN);
        } else {
            self.getLogger().pushGeneralActionLog('성벽 수비대장을 <C>저격</>했다!', LogFormat.PLAIN);
            self.getLogger().pushGeneralBattleDetailLog('성벽 수비대장을 <C>저격</>했다!', LogFormat.PLAIN);
        }

        const addAtmos = Number(selfEnv['addAtmos'] ?? 0);
        self.addAtmos(addAtmos);

        if (!oppose.hasActivatedSkill('부상무효') && oppose instanceof WarUnitGeneral) {
            const woundMin = Number(selfEnv['woundMin'] ?? 10);
            const woundMax = Number(selfEnv['woundMax'] ?? 80);
            oppose.getGeneral().injury = clamp(
                oppose.getGeneral().injury + self.rng.nextRangeInt(woundMin, woundMax),
                0,
                80
            );
        }

        this.processConsumableItem();
        return true;
    }
}
