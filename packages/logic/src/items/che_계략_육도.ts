import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_계략_육도';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '육도',
    name: '육도(계략)',
    info: '[계략] 화계·탈취·파괴·선동 : 성공률 +20%p<br>[전투] 계략 시도 확률 +10%p, 계략 성공 확률 +10%p',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '계략' && varType === 'success') {
            return value + 0.2;
        }
        return value;
    },
    onCalcStat: function (
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: unknown
    ): unknown {
        if (statName === 'warMagicTrialProb' || statName === 'warMagicSuccessProb') {
            return (value as number) + 0.1;
        }
        return value;
    } as NonNullable<ItemModule['onCalcStat']>,
};
