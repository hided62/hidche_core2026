import { JosaUtil } from '@sammo-ts/common';
import type { City, General } from '@sammo-ts/logic/domain/entities.js';
import type { StateView } from '@sammo-ts/logic/constraints/types.js';

export const formatDestCityConstraintFailure = (
    reason: string,
    commandName: string,
    destCityId: number,
    view: StateView,
    relation: 'direction' | 'location'
): string | null => {
    const city = view.get({ kind: 'destCity', id: destCityId }) as City | null;
    if (!city) {
        return null;
    }
    const particle = relation === 'direction' ? JosaUtil.pick(city.name, '로') : '에';
    return `${reason} <G><b>${city.name}</b></>${particle} ${commandName} 실패.`;
};

export const formatDestGeneralConstraintFailure = (
    reason: string,
    commandName: string,
    destGeneralId: number,
    view: StateView
): string | null => {
    const general = view.get({ kind: 'destGeneral', id: destGeneralId }) as General | null;
    if (!general) {
        return null;
    }
    return `${reason} <Y>${general.name}</> ${commandName} 실패.`;
};
