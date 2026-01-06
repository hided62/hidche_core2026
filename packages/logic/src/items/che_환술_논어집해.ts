import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { ItemModule } from './types.js';

export const itemModule: ItemModule = {
    key: 'che_환술_논어집해',
    rawName: '논어집해',
    name: '논어집해(환술)',
    info: '[전투] 계략 성공 확률 +10%p, 계략 성공 시 대미지 +20%',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: true,
    onCalcStat: function (
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: unknown
    ): unknown {
        let newValue = value;
        if (statName === 'warMagicSuccessProb') {
            newValue = (newValue as number) + 0.1;
        }
        if (statName === 'warMagicSuccessDamage') {
            newValue = (newValue as number) * 1.2;
        }
        return newValue;
    } as NonNullable<ItemModule['onCalcStat']>,
};
