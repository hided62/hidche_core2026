import { TraitRequirement, TraitWeightType } from '../requirements.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { getMetaNumber } from '@sammo-ts/logic/war/utils.js';
import { WarUnitCity } from '@sammo-ts/logic/war/units.js';
import { getAuxArmType, parseWarDexAux } from './aux.js';

function onCalcStat(context: GeneralActionContext, statName: GeneralStatName, value: number, aux?: unknown): number;
function onCalcStat(
    context: WarActionContext,
    statName: WarStatName,
    value: number | [number, number],
    aux?: unknown
): number | [number, number];
function onCalcStat(
    context: GeneralActionContext | WarActionContext,
    statName: GeneralStatName | WarStatName,
    value: number | [number, number],
    aux?: unknown
): number | [number, number] {
    if (!('unit' in context) || !context.unit) {
        return value;
    }
    const unit = context.unit;

    const siegeType = unit.getGameConfig().armTypes.siege;
    if (siegeType === undefined) {
        return value;
    }

    if (statName.startsWith('dex')) {
        const myDex = getMetaNumber(context.general.meta, `dex${siegeType}`);
        const { isAttacker, opposeType } = parseWarDexAux(aux);

        if (isAttacker && opposeType && statName === `dex${opposeType.armType}`) {
            return (value as number) + myDex;
        }
        if (!isAttacker && statName === `dex${siegeType}`) {
            return (value as number) + myDex;
        }
    }
    return value;
}

// 전투 특기: 공성
export const traitModule: TraitModule = {
    key: 'che_공성',
    name: '공성',
    info: '[군사] 차병 계통 징·모병비 -10%<br>[전투] 성벽 공격 시 대미지 +100%,<br>공격시 상대 병종에/수비시 자신 병종 숙련에 차병 숙련을 가산',
    kind: 'war',
    selection: {
        weight: 1,
        weightType: TraitWeightType.NORM,
        requirements: [TraitRequirement.STAT_LEADERSHIP | TraitRequirement.REQ_DEXTERITY | TraitRequirement.ARMY_SIEGE],
    },
    getName: () => '공성',
    getInfo: () =>
        '[군사] 차병 계통 징·모병비 -10%<br>[전투] 성벽 공격 시 대미지 +100%,<br>공격시 상대 병종에/수비시 자신 병종 숙련에 차병 숙련을 가산',
    onCalcDomestic: (_context, turnType, varType, value, aux) => {
        if (turnType === '징병' || turnType === '모병') {
            const armType = getAuxArmType(aux);
            if (varType === 'cost' && armType === 5) {
                return value * 0.9;
            }
        }
        return value;
    },
    getWarPowerMultiplier: (_context, _unit, oppose) => {
        if (oppose instanceof WarUnitCity) {
            return [2, 1];
        }
        return [1, 1];
    },
    onCalcStat,
};
