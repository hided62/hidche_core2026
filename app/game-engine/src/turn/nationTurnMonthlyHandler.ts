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

const readRate = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return 20;
};

const readSpyRemain = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return 0;
};

const decrementSpy = (value: unknown): Record<string, number> => {
    let raw: unknown = value;
    if (typeof value === 'string') {
        try {
            raw = JSON.parse(value);
        } catch {
            raw = {};
        }
    }
    const result: Record<string, number> = {};
    for (const [cityId, remain] of Object.entries(asRecord(raw))) {
        const numeric = readSpyRemain(remain);
        if (numeric > 1) {
            result[cityId] = numeric - 1;
        }
    }
    return result;
};

// ref preUpdateMonthly(): 국가 제한·세율·첩보는 MONTH action보다 먼저 갱신한다.
export const createNationTurnMonthlyHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): TurnCalendarHandler => ({
    beforeMonthChanged: () => {
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
                    rate_tmp: readRate(meta.rate),
                    spy: decrementSpy(meta.spy),
                },
            });
        }
    },
});
