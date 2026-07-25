import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';

import type { IncomeHandler } from './incomeHandler.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler } from './monthlyEventHandler.js';

const parseLogFormat = (value: unknown): LogFormat => {
    if (value === undefined) {
        return LogFormat.YEAR_MONTH;
    }
    if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < LogFormat.RAWTEXT ||
        value > LogFormat.NOTICE_YEAR_MONTH
    ) {
        throw new Error('NoticeToHistoryLog format must be an integer from 0 through 8.');
    }
    return value;
};

export const createProcessIncomeActionHandler = (incomeHandler: IncomeHandler): MonthlyEventActionHandler => {
    return (args) => {
        const resource = args[0];
        if (resource !== 'gold' && resource !== 'rice') {
            throw new Error('ProcessIncome resource must be gold or rice.');
        }
        incomeHandler.runResource(resource);
    };
};

export const createNoticeToHistoryLogHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): MonthlyEventActionHandler => {
    return (args, environment) => {
        const text = args[0];
        if (typeof text !== 'string') {
            throw new Error('NoticeToHistoryLog message must be a string.');
        }
        const world = options.getWorld();
        if (!world) {
            return;
        }
        world.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            text,
            format: parseLogFormat(args[1]),
            year: environment.year,
            month: environment.month,
        });
    };
};

export const createNewYearHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): MonthlyEventActionHandler => {
    return (_args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        for (const general of world.listGenerals()) {
            const belong = general.meta.belong;
            world.updateGeneral(general.id, {
                age: general.age + 1,
                meta: {
                    ...general.meta,
                    ...(general.nationId !== 0
                        ? { belong: typeof belong === 'number' && Number.isFinite(belong) ? belong + 1 : 1 }
                        : {}),
                },
            });
        }
        world.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.ACTION,
            text: `<C>${environment.year}</>년이 되었습니다.`,
            format: LogFormat.MONTH,
        });
    };
};

export const createResetOfficerLockHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): MonthlyEventActionHandler => {
    return () => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        for (const nation of world.listNations()) {
            world.updateNation(nation.id, { meta: { ...nation.meta, chief_set: 0 } });
        }
        for (const city of world.listCities()) {
            world.updateCity(city.id, { meta: { ...city.meta, officer_set: 0 } });
        }
    };
};
