import type { TurnDaemonHooks, TurnDaemonCommandHandler, TurnDaemonCommandResult, TurnRunResult } from '../lifecycle/types.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';

const buildFlushResult = (world: InMemoryTurnWorld): TurnRunResult => {
    const state = world.getState();
    return {
        lastTurnTime: state.lastTurnTime.toISOString(),
        processedGenerals: 0,
        processedTurns: 0,
        durationMs: 0,
        partial: false,
        checkpoint: world.getCheckpoint(),
    };
};

const flushWorld = async (
    world: InMemoryTurnWorld,
    hooks?: TurnDaemonHooks
): Promise<void> => {
    if (!hooks?.flushChanges) {
        return;
    }
    await hooks.flushChanges(buildFlushResult(world));
};

export const createTurnDaemonCommandHandler = (options: {
    world: InMemoryTurnWorld;
    hooks?: TurnDaemonHooks;
}): TurnDaemonCommandHandler => {
    return {
        handle: async (command): Promise<TurnDaemonCommandResult | null> => {
            if (command.type === 'troopJoin') {
                const general = options.world.getGeneralById(command.generalId);
                if (!general) {
                    return {
                        type: 'troopJoin',
                        ok: false,
                        generalId: command.generalId,
                        troopId: command.troopId,
                        reason: '장수 정보를 찾을 수 없습니다.',
                    };
                }
                if (general.troopId !== 0) {
                    return {
                        type: 'troopJoin',
                        ok: false,
                        generalId: command.generalId,
                        troopId: command.troopId,
                        reason: '이미 부대에 소속되어 있습니다.',
                    };
                }
                if (general.nationId <= 0) {
                    return {
                        type: 'troopJoin',
                        ok: false,
                        generalId: command.generalId,
                        troopId: command.troopId,
                        reason: '국가에 소속되어 있지 않습니다.',
                    };
                }

                const troop = options.world.getTroopById(command.troopId);
                if (!troop || troop.nationId !== general.nationId) {
                    return {
                        type: 'troopJoin',
                        ok: false,
                        generalId: command.generalId,
                        troopId: command.troopId,
                        reason: '부대가 올바르지 않습니다.',
                    };
                }

                options.world.updateGeneral(command.generalId, {
                    troopId: command.troopId,
                });
                await flushWorld(options.world, options.hooks);
                return {
                    type: 'troopJoin',
                    ok: true,
                    generalId: command.generalId,
                    troopId: command.troopId,
                };
            }

            if (command.type === 'troopExit') {
                const general = options.world.getGeneralById(command.generalId);
                if (!general) {
                    return {
                        type: 'troopExit',
                        ok: false,
                        generalId: command.generalId,
                        reason: '장수 정보를 찾을 수 없습니다.',
                    };
                }
                if (general.troopId === 0) {
                    return {
                        type: 'troopExit',
                        ok: false,
                        generalId: command.generalId,
                        reason: '부대에 소속되어 있지 않습니다.',
                    };
                }

                if (general.troopId !== general.id) {
                    options.world.updateGeneral(command.generalId, {
                        troopId: 0,
                    });
                    await flushWorld(options.world, options.hooks);
                    return {
                        type: 'troopExit',
                        ok: true,
                        generalId: command.generalId,
                        wasLeader: false,
                    };
                }

                const troopId = general.troopId;
                const members = options.world
                    .listGenerals()
                    .filter((entry) => entry.troopId === troopId);
                for (const member of members) {
                    options.world.updateGeneral(member.id, { troopId: 0 });
                }
                options.world.removeTroop(troopId);
                await flushWorld(options.world, options.hooks);
                return {
                    type: 'troopExit',
                    ok: true,
                    generalId: command.generalId,
                    wasLeader: true,
                };
            }

            return null;
        },
    };
};
