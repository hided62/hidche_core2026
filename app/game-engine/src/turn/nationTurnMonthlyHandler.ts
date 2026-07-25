import { asRecord } from '@sammo-ts/common';

import type { InMemoryTurnWorld, TurnCalendarHandler } from './inMemoryWorld.js';

const decrementLimit = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.floor(value) - 1);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.floor(parsed) - 1);
        }
    }
    return 0;
};

// ref preUpdateMonthly(): 전략 제한과 외교 제한은 매 월턴마다 1씩 감소한다.
export const createNationTurnMonthlyHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): TurnCalendarHandler => ({
    onMonthChanged: () => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        for (const nation of world.listNations()) {
            const meta = asRecord(nation.meta);
            world.updateNation(nation.id, {
                meta: {
                    ...nation.meta,
                    strategic_cmd_limit: decrementLimit(meta.strategic_cmd_limit),
                    surlimit: decrementLimit(meta.surlimit),
                },
            });
        }
    },
});
