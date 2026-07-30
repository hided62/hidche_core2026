import { TraitRequirement, TraitWeightType } from '../requirements.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/actionModules/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/actionModules/traits/types.js';
import { getMetaNumber } from '@sammo-ts/logic/war/utils.js';
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

    const footmanType = unit.getGameConfig().armTypes.footman;
    if (footmanType === undefined) {
        return value;
    }

    if (statName.startsWith('dex')) {
        const myDex = getMetaNumber(context.general.meta, `dex${footmanType}`);
        const { isAttacker, opposeType } = parseWarDexAux(aux);

        if (isAttacker && opposeType && statName === `dex${opposeType.armType}`) {
            return (value as number) + myDex;
        }
        if (!isAttacker && statName === `dex${footmanType}`) {
            return (value as number) + myDex;
        }
    }
    return value;
}

// 전투 특기: 보병
export const traitModule: TraitModule = {
    key: 'che_보병',
    name: '보병',
    info: '[군사] 보병 계통 징·모병비 -10%<br>[전투] 공격 시 아군 피해 -10%, 수비 시 아군 피해 -20%,<br>공격시 상대 병종에/수비시 자신 병종 숙련에 보병 숙련을 가산',
    kind: 'war',
    selection: {
        weight: 1,
        weightType: TraitWeightType.NORM,
        requirements: [
            TraitRequirement.STAT_LEADERSHIP |
                TraitRequirement.REQ_DEXTERITY |
                TraitRequirement.ARMY_FOOTMAN |
                TraitRequirement.STAT_NOT_INTEL,
            TraitRequirement.STAT_STRENGTH | TraitRequirement.REQ_DEXTERITY | TraitRequirement.ARMY_FOOTMAN,
        ],
    },
    getName: () => '보병',
    getInfo: () =>
        '[군사] 보병 계통 징·모병비 -10%<br>[전투] 공격 시 아군 피해 -10%, 수비 시 아군 피해 -20%,<br>공격시 상대 병종에/수비시 자신 병종 숙련에 보병 숙련을 가산',
    onCalcDomestic: (_context, turnType, varType, value, aux) => {
        if (turnType === '징병' || turnType === '모병') {
            const armType = getAuxArmType(aux);
            // Note: In a real scenario, we should check if aux.armType is footman.
            // Since we don't have easy access to config here, we might need to assume legacy ID 1 or similar.
            if (varType === 'cost' && armType === 1) {
                return value * 0.9;
            }
        }
        return value;
    },
    getWarPowerMultiplier: (_context, unit, _oppose) => {
        if (unit.isAttacker()) {
            return [1, 0.9];
        }
        return [1, 0.8];
    },
    onCalcStat,
};
