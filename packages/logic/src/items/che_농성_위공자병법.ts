import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_농성_위공자병법';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '위공자병법',
    name: '위공자병법(농성)',
    info: '[계략] 장수 주둔 도시 화계·탈취·파괴·선동 : 성공률 -30%p<br>[전투] 상대 계략 시도 확률 -10%p, 상대 계략 성공 확률 -10%p',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    onCalcStat: function (
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: unknown
    ): unknown {
        if (statName === 'sabotageDefence') {
            return (value as number) + 0.3;
        }
        return value;
    } as NonNullable<ItemModule['onCalcStat']>,
    onCalcOpposeStat: function (
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: unknown
    ): unknown {
        if (statName === 'warMagicTrialProb' || statName === 'warMagicSuccessProb') {
            return (value as number) - 0.1;
        }
        return value;
    } as NonNullable<ItemModule['onCalcOpposeStat']>,
};
