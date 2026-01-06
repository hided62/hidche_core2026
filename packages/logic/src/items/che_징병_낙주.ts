import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_징병_낙주';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '낙주',
    name: '낙주(징병)',
    info: '[군사] 징·모병비 -30%<br>[기타] 통솔 순수 능력치 보정 +15%, 징병/모병/소집해제 시 인구 변동 없음',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '징병' || turnType === '모병') {
            if (varType === 'cost') return value * 0.7;
        }
        if (turnType === '징집인구' && varType === 'score') {
            return 0;
        }
        return value;
    },
    onCalcStat: function (
        context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: unknown
    ): unknown {
        if (statName === 'leadership') {
            return (value as number) + (context as unknown as GeneralActionContext).general.stats.leadership * 0.15;
        }
        return value;
    } as NonNullable<ItemModule['onCalcStat']>,
};
