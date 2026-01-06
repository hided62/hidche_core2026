import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { TraitRequirement, TraitWeightType } from '../requirements.js';
import { getMetaNumber } from '@sammo-ts/logic/war/utils.js';

import { WarUnit } from '@sammo-ts/logic/war/units.js';

type WarUnitWithGeneral = WarUnit & { getGeneral: () => { meta: Record<string, unknown> } };

const hasGeneral = (unit: WarUnit): unit is WarUnitWithGeneral =>
    'getGeneral' in unit && typeof (unit as { getGeneral?: unknown }).getGeneral === 'function';

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
    const isAttacker = typeof aux === 'object' && aux !== null && (aux as { isAttacker?: unknown }).isAttacker === true;

    if (statName === 'warCriticalRatio' && isAttacker && typeof value === 'number') {
        return value + 0.1;
    }
    return value;
}

export const traitModule: TraitModule = {
    key: 'che_무쌍',
    name: '무쌍',
    info: '[전투] 대미지 +5%, 피해 -2%, 공격 시 필살 확률 +10%p, <br>승리 수의 로그 비례로 대미지 상승(10회 ⇒ +5%, 40회 ⇒ +15%)<br>승리 수의 로그 비례로 피해 감소(10회 ⇒ -2%, 40회 ⇒ -6%)',
    kind: 'war',
    getName: () => '무쌍',
    getInfo: () =>
        '[전투] 대미지 +5%, 피해 -2%, 공격 시 필살 확률 +10%p, <br>승리 수의 로그 비례로 대미지 상승(10회 ⇒ +5%, 40회 ⇒ +15%)<br>승리 수의 로그 비례로 피해 감소(10회 ⇒ -2%, 40회 ⇒ -6%)',
    selection: {
        requirements: [TraitRequirement.STAT_STRENGTH],
        weight: 1,
        weightType: TraitWeightType.NORM,
    },
    getWarPowerMultiplier: (_context, unit, _oppose) => {
        let attackMultiplier = 1.05;
        let defenceMultiplier = 0.98;
        // Note: unit.getGeneral() is only available for WarUnitGeneral.
        // In a real scenario, we should check if unit is WarUnitGeneral.
        if (hasGeneral(unit)) {
            const killnum = getMetaNumber(
                unit.getGeneral().meta as Record<string, import('@sammo-ts/logic/domain/entities.js').TriggerValue>,
                'rank_killnum',
                0
            );
            const logVal = Math.log2(Math.max(1, killnum / 5));
            attackMultiplier += logVal / 20;
            defenceMultiplier -= logVal / 50;
        }
        return [attackMultiplier, defenceMultiplier];
    },
    onCalcStat,
};
