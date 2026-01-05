import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';
import { LogFormat } from '@sammo-ts/logic/logging/types.js';

class che_위압시도 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, 10100);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (self.getPhase() !== 0 && oppose.getPhase() !== 0) {
            return true;
        }
        if (self.hasActivatedSkill('위압불가')) {
            return true;
        }

        self.activateSkill('위압');
        oppose.activateSkill('회피불가', '필살불가', '계략불가');
        return true;
    }
}

class che_위압발동 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, 40700);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!self.hasActivatedSkill('위압')) {
            return true;
        }

        oppose.getLogger().pushGeneralBattleDetailLog('상대에게 <R>위압</>받았다!', LogFormat.PLAIN);
        self.getLogger().pushGeneralBattleDetailLog('상대에게 <C>위압</>을 줬다!', LogFormat.PLAIN);
        oppose.setWarPowerMultiply(0);
        if ('addAtmos' in oppose) {
            (oppose as any).addAtmos(-5);
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
    key: 'che_위압',
    name: '위압',
    info: '[전투] 첫 페이즈 위압 발동(적 공격, 회피 불가, 사기 5 감소)',
    kind: 'war',
    getName: () => '위압',
    getInfo: () => '[전투] 첫 페이즈 위압 발동(적 공격, 회피 불가, 사기 5 감소)',
    getBattlePhaseTriggerList: (_context) => {
        if (!_context.unit) return null;
        return new WarTriggerCaller(new che_위압시도(_context.unit), new che_위압발동(_context.unit));
    },
    onCalcStat,
};
