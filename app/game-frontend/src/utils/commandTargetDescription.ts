import type { CommandOption } from '../components/command/types';

export const commandTargetDescription = (commandKey: string, option?: CommandOption): string => {
    if (!option) return '';
    const description = option.description ?? '';
    // 이전 API는 완성된 description을 주므로 새 원본 필드가 없으면 그대로 표시한다.
    if (option.targetNames?.troopName === undefined || commandKey === 'che_포상' || commandKey === 'che_몰수') {
        return description;
    }
    const troopName = option.targetNames.troopName ?? (option.troopId ? `#${option.troopId}` : '없음');
    const leader = option.troopId && option.troopId === option.value ? ' (부대장)' : '';
    const troop = `탑승 부대 ${troopName}${leader}`;
    return commandKey === 'che_발령'
        ? [troop, description].filter(Boolean).join('\n')
        : [description, troop].filter(Boolean).join(' · ');
};
