import type { CommandMapData, CommandOption } from './types';

export const commandCityOptions = (
    commandKey: string,
    options: readonly CommandOption[],
    mapData?: CommandMapData | null
): CommandOption[] => {
    if (commandKey !== 'che_발령' || typeof mapData?.myNation !== 'number') return [...options];

    const nationByCityId = new Map(mapData.cityList.map(([cityId, , , nationId]) => [cityId, nationId]));
    return options
        .map((option, index) => ({ option, index }))
        .sort((left, right) => {
            const leftOwned =
                typeof left.option.value === 'number' && nationByCityId.get(left.option.value) === mapData.myNation;
            const rightOwned =
                typeof right.option.value === 'number' && nationByCityId.get(right.option.value) === mapData.myNation;
            return Number(rightOwned) - Number(leftOwned) || left.index - right.index;
        })
        .map(({ option }) => option);
};
