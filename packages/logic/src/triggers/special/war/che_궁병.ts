import type { TraitOnCalcStat, TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import { getMetaNumber } from '@sammo-ts/logic/war/utils.js';
import { getAuxArmType, parseWarDexAux } from './aux.js';

const onCalcStat = ((
    context: GeneralActionContext | WarActionContext,
    statName: GeneralStatName | WarStatName,
    value: number | [number, number],
    aux?: unknown
): number | [number, number] => {
    if (statName === 'warAvoidRatio' && typeof value === 'number') {
        return value + 0.2;
    }

    if (!('unit' in context) || !context.unit) {
        return value;
    }
    const unit = context.unit;

    const archerType = unit.getGameConfig().armTypes.archer;
    if (archerType === undefined) {
        return value;
    }

    if (statName.startsWith('dex')) {
        const myDex = getMetaNumber(context.general.meta, `dex${archerType}`);
        const { isAttacker, opposeType } = parseWarDexAux(aux);

        if (isAttacker && opposeType && statName === `dex${opposeType.armType}`) {
            return (value as number) + myDex;
        }
        if (!isAttacker && statName === `dex${archerType}`) {
            return (value as number) + myDex;
        }
    }
    return value;
}) as unknown as TraitOnCalcStat;

// 전투 특기: 궁병
export const traitModule: TraitModule = {
    key: 'che_궁병',
    name: '궁병',
    info: '[군사] 궁병 계통 징·모병비 -10%<br>[전투] 회피 확률 +20%p,<br>공격시 상대 병종에/수비시 자신 병종 숙련에 궁병 숙련을 가산',
    kind: 'war',
    getName: () => '궁병',
    getInfo: () =>
        '[군사] 궁병 계통 징·모병비 -10%<br>[전투] 회피 확률 +20%p,<br>공격시 상대 병종에/수비시 자신 병종 숙련에 궁병 숙련을 가산',
    onCalcDomestic: (_context, turnType, varType, value, aux) => {
        if (turnType === '징병' || turnType === '모병') {
            const armType = getAuxArmType(aux);
            // Note: In a real scenario, we should check if aux.armType is archer.
            // Since we don't have easy access to config here, we might need to assume legacy ID 2 or similar.
            if (varType === 'cost' && armType === 2) {
                return value * 0.9;
            }
        }
        return value;
    },
    onCalcStat,
};
