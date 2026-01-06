import { TraitRequirement, TraitWeightType } from '../requirements.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
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
    if (statName === 'warMagicSuccessProb') {
        return (value as number) + 0.2;
    }

    if (!('unit' in context) || !context.unit) {
        return value;
    }
    const unit = context.unit;

    const wizardType = unit.getGameConfig().armTypes.wizard;
    if (wizardType === undefined) {
        return value;
    }

    if (statName.startsWith('dex')) {
        const myDex = getMetaNumber(context.general.meta, `dex${wizardType}`);
        const { isAttacker, opposeType } = parseWarDexAux(aux);

        if (isAttacker && opposeType && statName === `dex${opposeType.armType}`) {
            return (value as number) + myDex;
        }
        if (!isAttacker && statName === `dex${wizardType}`) {
            return (value as number) + myDex;
        }
    }
    return value;
}

// 전투 특기: 귀병
export const traitModule: TraitModule = {
    key: 'che_귀병',
    name: '귀병',
    info: '[군사] 귀병 계통 징·모병비 -10%<br>[전투] 계략 성공 확률 +20%p,<br>공격시 상대 병종에/수비시 자신 병종 숙련에 귀병 숙련을 가산',
    kind: 'war',
    selection: {
        weight: 1,
        weightType: TraitWeightType.NORM,
        requirements: [
            TraitRequirement.STAT_INTEL |
                TraitRequirement.ARMY_WIZARD |
                TraitRequirement.REQ_DEXTERITY |
                TraitRequirement.STAT_NOT_STRENGTH,
        ],
    },
    getName: () => '귀병',
    getInfo: () =>
        '[군사] 귀병 계통 징·모병비 -10%<br>[전투] 계략 성공 확률 +20%p,<br>공격시 상대 병종에/수비시 자신 병종 숙련에 귀병 숙련을 가산',
    onCalcDomestic: (_context, turnType, varType, value, aux) => {
        if (turnType === '징병' || turnType === '모병') {
            const armType = getAuxArmType(aux);
            if (varType === 'cost' && armType === 4) {
                return value * 0.9;
            }
        }
        return value;
    },
    onCalcStat,
};
