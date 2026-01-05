import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';
import { LogFormat } from '@sammo-ts/logic/logging/types.js';

class che_저격시도 extends BaseWarUnitTrigger {
    private readonly ratio: number;
    private readonly woundMin: number;
    private readonly woundMax: number;
    private readonly addAtmos: number;

    constructor(unit: WarUnit, ratio: number, woundMin: number, woundMax: number, addAtmos = 20) {
        super(unit, 20100);
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

class che_저격발동 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, 40100);
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

        if (((selfEnv['저격발동자'] as number) ?? -1) !== this.raiseType) {
            return true;
        }

        if ((selfEnv['저격발동'] as boolean) ?? false) {
            return true;
        }
        selfEnv['저격발동'] = true;

        if (oppose.constructor.name === 'WarUnitGeneral') {
            self.getLogger().pushGeneralActionLog('상대를 <C>저격</>했다!', LogFormat.PLAIN);
            self.getLogger().pushGeneralBattleDetailLog('상대를 <C>저격</>했다!', LogFormat.PLAIN);
            oppose.getLogger().pushGeneralActionLog('상대에게 <R>저격</>당했다!', LogFormat.PLAIN);
            oppose.getLogger().pushGeneralBattleDetailLog('상대에게 <R>저격</>당했다!', LogFormat.PLAIN);
        } else {
            self.getLogger().pushGeneralActionLog('성벽 수비대장을 <C>저격</>했다!', LogFormat.PLAIN);
            self.getLogger().pushGeneralBattleDetailLog('성벽 수비대장을 <C>저격</>했다!', LogFormat.PLAIN);
        }

        if ('addAtmos' in self) {
            (self as any).addAtmos(selfEnv['addAtmos'] as number);
        }

        return true;
    }
}

function onCalcStat(context: GeneralActionContext, statName: GeneralStatName, value: number, aux?: unknown): number;
function onCalcStat(
    context: WarActionContext,
    statName: WarStatName,
    value: number | [number, number],
    aux?: unknown
): number | [number, number];
function onCalcStat(
    _context: GeneralActionContext | WarActionContext,
    _statName: GeneralStatName | WarStatName,
    value: number | [number, number],
    _aux?: unknown
): number | [number, number] {
    return value;
}

export const traitModule: TraitModule = {
    key: 'che_저격',
    name: '저격',
    info: '[전투] 새로운 상대와 전투 시 50% 확률로 저격 발동, 성공 시 사기+20',
    kind: 'war',
    getName: () => '저격',
    getInfo: () => '[전투] 새로운 상대와 전투 시 50% 확률로 저격 발동, 성공 시 사기+20',
    getBattlePhaseTriggerList: (_context) => {
        if (!_context.unit) return null;
        return new WarTriggerCaller(new che_저격시도(_context.unit, 0.5, 20, 40, 20), new che_저격발동(_context.unit));
    },
    onCalcStat,
};
