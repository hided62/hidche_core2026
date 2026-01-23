import { createTournamentAutoStartHandler as createCommonTournamentAutoStartHandler } from '@sammo-ts/common';
import type { RedisConnector } from '@sammo-ts/infra';

import type { TurnCalendarHandler } from './inMemoryWorld.js';

export const createTournamentAutoStartHandler = (options: {
    profileName: string;
    getRedisClient: () => RedisConnector['client'] | null | undefined;
    getWorldConfig: () => Record<string, unknown> | null | undefined;
    getTickSeconds: () => number | null | undefined;
}): TurnCalendarHandler => {
    return createCommonTournamentAutoStartHandler(options);
};