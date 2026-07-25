import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler } from './monthlyEventHandler.js';

const readOptionalBlockFlag = (value: unknown, actionName: string): boolean | null => {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'boolean') {
        throw new Error(`${actionName} blockChangeScout must be a boolean or null.`);
    }
    return value;
};

export const createScoutBlockHandler = (options: {
    actionName: 'BlockScoutAction' | 'UnblockScoutAction';
    getWorld: () => InMemoryTurnWorld | null;
}): MonthlyEventActionHandler => {
    return (args) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        if (options.actionName === 'UnblockScoutAction') {
            // ref omits MeekroDB's required WHERE argument and fails before
            // changing nation or game state. No provided scenario invokes it.
            throw new Error('update(): at least 3 arguments expected');
        }
        for (const nation of world.listNations()) {
            world.updateNation(nation.id, {
                meta: {
                    ...nation.meta,
                    scout: 1,
                },
            });
        }
        const blockChangeScout = readOptionalBlockFlag(args[0], options.actionName);
        if (blockChangeScout !== null) {
            world.updateWorldMeta({ block_change_scout: blockChangeScout });
        }
    };
};
