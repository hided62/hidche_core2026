import type { CrewTypeActionModule } from '../types.js';

export const actionModule: CrewTypeActionModule = {
    key: 'che_성벽선제',
    name: '성벽선제',
    info: '전투 가능한 성벽이라면 선제공격을 합니다.',
    war: {
        onCalcOpposeStat: (_context, statName, value) => {
            if (statName === 'cityBattleOrder') {
                return 10000;
            }
            return value;
        },
    },
};
