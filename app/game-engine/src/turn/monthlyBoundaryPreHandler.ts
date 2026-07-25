import { asRecord } from '@sammo-ts/common';
import type { TurnCommandEnv } from '@sammo-ts/logic';

import type { InMemoryTurnWorld, TurnCalendarHandler } from './inMemoryWorld.js';

const CITY_STATE_TRANSITIONS = new Map<number, number>([
    [31, 0],
    [32, 31],
    [33, 0],
    [34, 33],
    [41, 0],
    [42, 41],
    [43, 42],
]);

const readFiniteNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

/**
 * ref preUpdateMonthly()에서 국가 외 상태를 날짜 변경 전에 갱신한다.
 * 연감 저장은 이 handler보다 먼저, MONTH event는 이 handler보다 나중에
 * 실행되도록 turnDaemon의 calendar handler 순서가 계약을 보장한다.
 */
export const createMonthlyBoundaryPreHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    startYear: number;
    commandEnv: TurnCommandEnv;
}): TurnCalendarHandler => ({
    beforeMonthChanged: (context) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }

        const develCost = (context.previousYear - options.startYear + 10) * 2;
        options.commandEnv.develCost = develCost;
        world.updateWorldMeta({ develcost: develCost });

        for (const general of world.listGenerals()) {
            const meta = asRecord(general.meta);
            world.updateGeneral(general.id, {
                ...(general.refreshScoreTotal === undefined
                    ? {}
                    : { refreshScoreTotal: Math.floor(readFiniteNumber(general.refreshScoreTotal) * 0.99) }),
                meta: {
                    ...general.meta,
                    makelimit: Math.max(0, Math.floor(readFiniteNumber(meta.makelimit)) - 1),
                },
            });
        }

        for (const city of world.listCities()) {
            const meta = asRecord(city.meta);
            const nextTerm = Math.max(0, Math.floor(readFiniteNumber(meta.term)) - 1);
            world.updateCity(city.id, {
                state: CITY_STATE_TRANSITIONS.get(city.state) ?? city.state,
                conflict: nextTerm === 0 ? {} : city.conflict,
                meta: {
                    ...city.meta,
                    term: nextTerm,
                },
            });
        }
    },
});
