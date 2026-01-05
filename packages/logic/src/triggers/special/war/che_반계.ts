import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';
import { LogFormat } from '@sammo-ts/logic/logging/types.js';

class che_반계시도 extends BaseWarUnitTrigger {
    private readonly prob: number;

    constructor(unit: WarUnit, prob = 0.4) {
        super(unit, 30300);
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

class che_반계발동 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, 40250);
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

function onCalcStat(context: GeneralActionContext, statName: GeneralStatName, value: number, aux?: unknown): number;
function onCalcStat(
    context: WarActionContext,
    statName: WarStatName,
    value: number | [number, number],
    aux?: unknown
): number | [number, number];
function onCalcStat(
    _context: GeneralActionContext | WarActionContext,
    statName: GeneralStatName | WarStatName,
    value: number | [number, number],
    aux?: unknown
): number | [number, number] {
    if (statName === 'warMagicSuccessDamage' && aux === '반목') {
        return (value as number) + 0.9;
    }
    return value;
}

export const traitModule: TraitModule = {
    key: 'che_반계',
    name: '반계',
    info: '[전투] 상대의 계략 성공 확률 -10%p, 상대의 계략을 40% 확률로 되돌림, 반목 성공시 대미지 추가(+60% → +150%)',
    kind: 'war',
    getName: () => '반계',
    getInfo: () =>
        '[전투] 상대의 계략 성공 확률 -10%p, 상대의 계략을 40% 확률로 되돌림, 반목 성공시 대미지 추가(+60% → +150%)',
    onCalcOpposeStat: (_context, statName, value, _aux) => {
        if (statName === 'warMagicSuccessProb' && typeof value === 'number') {
            return value - 0.1;
        }
        return value;
    },
    getBattlePhaseTriggerList: (_context) => {
        if (!_context.unit) return null;
        return new WarTriggerCaller(new che_반계시도(_context.unit), new che_반계발동(_context.unit));
    },
    onCalcStat,
};
