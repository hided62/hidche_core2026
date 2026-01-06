import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import { clamp } from '@sammo-ts/logic/war/utils.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_능력치_통솔_보령압주';

const resolveNumber = (value: unknown, fallback = 0): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '보령압주',
    name: '보령압주(통솔)',
    info: '[능력치] 통솔 +5 +(4년마다 +1)',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    onCalcStat: function (
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: unknown,
        aux?: unknown
    ): unknown {
        if (statName === 'leadership') {
            const auxObj = aux as Record<string, unknown> | undefined;
            const year = resolveNumber(auxObj?.['year']);
            const startYear = resolveNumber(auxObj?.['startYear']);
            const maxTechLevel = resolveNumber(auxObj?.['maxTechLevel'], 12);
            const relYear = Math.max(0, year - startYear);
            const bonus = 5 + clamp(Math.floor(relYear / 4), 0, maxTechLevel);

            if (Array.isArray(value)) {
                return [value[0] + bonus, value[1] + bonus];
            }
            return (value as number) + bonus;
        }
        return value;
    } as NonNullable<ItemModule['onCalcStat']>,
};
