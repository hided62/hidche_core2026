import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { ItemModule, ItemSlot } from './types.js';

const resolveStatLabel = (statName: GeneralStatName): string => {
    switch (statName) {
        case 'leadership':
            return '통솔';
        case 'strength':
            return '무력';
        case 'intelligence':
            return '지력';
        default:
            return statName;
    }
};

export interface StatItemOptions {
    key: string;
    rawName: string;
    slot: ItemSlot;
    statName: 'leadership' | 'strength' | 'intelligence';
    statValue: number;
    cost: number | null;
    buyable: boolean;
    reqSecu: number;
    unique?: boolean;
    extraInfo?: string;
}

export const createStatItemModule = (options: StatItemOptions): ItemModule => {
    const statLabel = resolveStatLabel(options.statName);
    const name = `${options.rawName}(+${options.statValue})`;
    const baseInfo = `${statLabel} +${options.statValue}`;
    const info = options.extraInfo ? `${baseInfo}<br>${options.extraInfo}` : baseInfo;
    function onCalcStat(
        _context: GeneralActionContext,
        statName: GeneralStatName,
        value: number,
        _aux?: unknown
    ): number;
    function onCalcStat(
        _context: WarActionContext,
        statName: WarStatName,
        value: number | [number, number],
        _aux?: unknown
    ): number | [number, number];
    function onCalcStat(
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: number | [number, number]
    ): number | [number, number] {
        if (statName !== options.statName) {
            return value;
        }
        if (Array.isArray(value)) {
            return value;
        }
        return value + options.statValue;
    }

    return {
        key: options.key,
        rawName: options.rawName,
        name,
        info,
        slot: options.slot,
        cost: options.cost,
        buyable: options.buyable,
        consumable: false,
        reqSecu: options.reqSecu,
        unique: options.unique ?? false,
        onCalcStat,
    };
};
