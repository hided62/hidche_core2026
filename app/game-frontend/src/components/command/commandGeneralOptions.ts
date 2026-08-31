import type { CommandOption } from './types';

const npcStateOf = (option: CommandOption): number => option.npcState ?? 0;

/** 장수 선택지는 유저장부터 NPC 종류순으로 묶고, 명령별 우선순위는 같은 종류 안에서만 적용한다. */
export const sortCommandGeneralOptions = (
    commandKey: string,
    options: readonly CommandOption[],
    isGold: boolean
): CommandOption[] => {
    const resourceKey = isGold ? 'gold' : 'rice';
    return options
        .map((option, index) => ({ option, index }))
        .sort((left, right) => {
            const typeOrder = npcStateOf(left.option) - npcStateOf(right.option);
            if (typeOrder !== 0) return typeOrder;

            if (commandKey === 'che_포상') {
                const resourceOrder = (left.option[resourceKey] ?? 0) - (right.option[resourceKey] ?? 0);
                if (resourceOrder !== 0) return resourceOrder;
            }
            if (commandKey === 'che_몰수') {
                const resourceOrder = (right.option[resourceKey] ?? 0) - (left.option[resourceKey] ?? 0);
                if (resourceOrder !== 0) return resourceOrder;
            }
            if (commandKey === 'che_부대탈퇴지시') {
                const availabilityOrder = Number(right.option.availableNow) - Number(left.option.availableNow);
                if (availabilityOrder !== 0) return availabilityOrder;
            }
            return left.index - right.index;
        })
        .map(({ option }) => option);
};
