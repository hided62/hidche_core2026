import type {
    TurnDaemonHooks,
    TurnDaemonCommandHandler,
    TurnDaemonCommand,
    TurnDaemonCommandResult,
    TurnRunResult,
} from '../lifecycle/types.js';
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

const flushWorld = async (world: InMemoryTurnWorld, hooks?: TurnDaemonHooks): Promise<void> => {
    if (!hooks?.flushChanges) {
        return;
    }
    await hooks.flushChanges(buildFlushResult(world));
};

interface CommandHandlerContext {
    world: InMemoryTurnWorld;
    hooks?: TurnDaemonHooks;
}

async function handleTroopJoin(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'troopJoin' }>
): Promise<TurnDaemonCommandResult> {
    const { world, hooks } = ctx;
    const general = world.getGeneralById(command.generalId);
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

    const troop = world.getTroopById(command.troopId);
    if (!troop || troop.nationId !== general.nationId) {
        return {
            type: 'troopJoin',
            ok: false,
            generalId: command.generalId,
            troopId: command.troopId,
            reason: '부대가 올바르지 않습니다.',
        };
    }

    world.updateGeneral(command.generalId, {
        troopId: command.troopId,
    });
    await flushWorld(world, hooks);
    return {
        type: 'troopJoin',
        ok: true,
        generalId: command.generalId,
        troopId: command.troopId,
    };
}

async function handleTroopExit(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'troopExit' }>
): Promise<TurnDaemonCommandResult> {
    const { world, hooks } = ctx;
    const general = world.getGeneralById(command.generalId);
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
        world.updateGeneral(command.generalId, {
            troopId: 0,
        });
        await flushWorld(world, hooks);
        return {
            type: 'troopExit',
            ok: true,
            generalId: command.generalId,
            wasLeader: false,
        };
    }

    const troopId = general.troopId;
    const members = world.listGenerals().filter((entry) => entry.troopId === troopId);
    for (const member of members) {
        world.updateGeneral(member.id, { troopId: 0 });
    }
    world.removeTroop(troopId);
    await flushWorld(world, hooks);
    return {
        type: 'troopExit',
        ok: true,
        generalId: command.generalId,
        wasLeader: true,
    };
}

async function handleDieOnPrestart(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'dieOnPrestart' }>
): Promise<TurnDaemonCommandResult> {
    const { world, hooks } = ctx;
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return {
            type: 'dieOnPrestart',
            ok: false,
            generalId: command.generalId,
            reason: '장수 정보를 찾을 수 없습니다.',
        };
    }
    const worldState = world.getState();
    const opentime = worldState.meta.opentime as string | undefined;
    if (opentime && new Date(worldState.lastTurnTime) > new Date(opentime)) {
        return { type: 'dieOnPrestart', ok: false, generalId: command.generalId, reason: '가오픈 기간이 아닙니다.' };
    }

    if (general.npcState !== 0 || general.nationId !== 0) {
        return { type: 'dieOnPrestart', ok: false, generalId: command.generalId, reason: '삭제할 수 없는 상태입니다.' };
    }

    world.removeGeneral(command.generalId);
    await flushWorld(world, hooks);
    return { type: 'dieOnPrestart', ok: true, generalId: command.generalId };
}

async function handleBuildNationCandidate(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'buildNationCandidate' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return {
            type: 'buildNationCandidate',
            ok: false,
            generalId: command.generalId,
            reason: '장수 정보를 찾을 수 없습니다.',
        };
    }
    if (general.nationId !== 0) {
        return {
            type: 'buildNationCandidate',
            ok: false,
            generalId: command.generalId,
            reason: '이미 국가에 소속되어 있습니다.',
        };
    }

    const worldState = world.getState();
    const opentime = worldState.meta.opentime as string | undefined;
    if (opentime && new Date(worldState.lastTurnTime) > new Date(opentime)) {
        return {
            type: 'buildNationCandidate',
            ok: false,
            generalId: command.generalId,
            reason: '가오픈 기간이 아닙니다.',
        };
    }

    return { type: 'buildNationCandidate', ok: true, generalId: command.generalId };
}

async function handleInstantRetreat(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'instantRetreat' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return {
            type: 'instantRetreat',
            ok: false,
            generalId: command.generalId,
            reason: '장수 정보를 찾을 수 없습니다.',
        };
    }

    const config = world.getScenarioConfig();
    const availableInstantAction = config.const.availableInstantAction as Record<string, boolean> | undefined;
    if (!availableInstantAction?.instantRetreat) {
        return {
            type: 'instantRetreat',
            ok: false,
            generalId: command.generalId,
            reason: '즉시 귀환이 허용되지 않는 서버입니다.',
        };
    }

    return { type: 'instantRetreat', ok: true, generalId: command.generalId };
}

async function handleVacation(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'vacation' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return { type: 'vacation', ok: false, generalId: command.generalId, reason: '장수 정보를 찾을 수 없습니다.' };
    }
    return { type: 'vacation', ok: true, generalId: command.generalId };
}

async function handleSetMySetting(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'setMySetting' }>
): Promise<TurnDaemonCommandResult> {
    const { world, hooks } = ctx;
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return {
            type: 'setMySetting',
            ok: false,
            generalId: command.generalId,
            reason: '장수 정보를 찾을 수 없습니다.',
        };
    }
    world.updateGeneral(command.generalId, {
        meta: {
            ...general.meta,
            ...command.settings,
        },
    });
    await flushWorld(world, hooks);
    return { type: 'setMySetting', ok: true, generalId: command.generalId };
}

async function handleDropItem(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'dropItem' }>
): Promise<TurnDaemonCommandResult> {
    const { world, hooks } = ctx;
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return { type: 'dropItem', ok: false, generalId: command.generalId, reason: '장수 정보를 찾을 수 없습니다.' };
    }
    const { itemType } = command;
    const items = { ...general.role.items };
    if (items.horse === itemType) items.horse = null;
    else if (items.weapon === itemType) items.weapon = null;
    else if (items.book === itemType) items.book = null;
    else if (items.item === itemType) items.item = null;
    else {
        return { type: 'dropItem', ok: false, generalId: command.generalId, reason: '아이템을 가지고 있지 않습니다.' };
    }

    world.updateGeneral(command.generalId, {
        role: {
            ...general.role,
            items,
        },
    });
    await flushWorld(world, hooks);
    return { type: 'dropItem', ok: true, generalId: command.generalId };
}

async function handleChangePermission(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'changePermission' }>
): Promise<TurnDaemonCommandResult> {
    const { world, hooks } = ctx;
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return {
            type: 'changePermission',
            ok: false,
            generalId: command.generalId,
            reason: '장수 정보를 찾을 수 없습니다.',
        };
    }
    const nation = world.getNationById(general.nationId);
    if (!nation || nation.chiefGeneralId !== general.id) {
        return { type: 'changePermission', ok: false, generalId: command.generalId, reason: '권한이 없습니다.' };
    }

    for (const targetId of command.targetGeneralIds) {
        const target = world.getGeneralById(targetId);
        if (target && target.nationId === general.nationId) {
            world.updateGeneral(targetId, {
                meta: {
                    ...target.meta,
                    permission: command.isAmbassador ? 'ambassador' : 'auditor',
                },
            });
        }
    }

    await flushWorld(world, hooks);
    return { type: 'changePermission', ok: true, generalId: command.generalId };
}

async function handleKick(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'kick' }>
): Promise<TurnDaemonCommandResult> {
    const { world, hooks } = ctx;
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return { type: 'kick', ok: false, generalId: command.generalId, reason: '장수 정보를 찾을 수 없습니다.' };
    }
    const nation = world.getNationById(general.nationId);
    if (!nation || nation.chiefGeneralId !== general.id) {
        return { type: 'kick', ok: false, generalId: command.generalId, reason: '권한이 없습니다.' };
    }

    const target = world.getGeneralById(command.destGeneralId);
    if (!target || target.nationId !== general.nationId) {
        return {
            type: 'kick',
            ok: false,
            generalId: command.generalId,
            reason: '대상을 찾을 수 없거나 같은 국가가 아닙니다.',
        };
    }

    world.updateGeneral(command.destGeneralId, {
        nationId: 0,
        officerLevel: 0,
    });

    await flushWorld(world, hooks);
    return { type: 'kick', ok: true, generalId: command.generalId };
}

async function handleAppoint(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'appoint' }>
): Promise<TurnDaemonCommandResult> {
    const { world, hooks } = ctx;
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return { type: 'appoint', ok: false, generalId: command.generalId, reason: '장수 정보를 찾을 수 없습니다.' };
    }
    const nation = world.getNationById(general.nationId);
    if (!nation || nation.chiefGeneralId !== general.id) {
        return { type: 'appoint', ok: false, generalId: command.generalId, reason: '권한이 없습니다.' };
    }

    const target = world.getGeneralById(command.destGeneralId);
    if (command.destGeneralId !== 0 && (!target || target.nationId !== general.nationId)) {
        return {
            type: 'appoint',
            ok: false,
            generalId: command.generalId,
            reason: '대상을 찾을 수 없거나 같은 국가가 아닙니다.',
        };
    }

    if (command.officerLevel >= 5) {
        for (const g of world.listGenerals()) {
            if (g.nationId === general.nationId && g.officerLevel === command.officerLevel) {
                world.updateGeneral(g.id, { officerLevel: 0 });
            }
        }
        if (command.destGeneralId !== 0) {
            world.updateGeneral(command.destGeneralId, { officerLevel: command.officerLevel });
        }
    } else {
        const city = world.getCityById(command.destCityId);
        if (!city || city.nationId !== general.nationId) {
            return {
                type: 'appoint',
                ok: false,
                generalId: command.generalId,
                reason: '도시를 찾을 수 없거나 아군 도시가 아닙니다.',
            };
        }
        for (const g of world.listGenerals()) {
            if (
                g.nationId === general.nationId &&
                g.meta.officerCity === command.destCityId &&
                g.officerLevel === command.officerLevel
            ) {
                world.updateGeneral(g.id, { officerLevel: 0, meta: { ...g.meta, officerCity: 0 } });
            }
        }
        if (command.destGeneralId !== 0) {
            world.updateGeneral(command.destGeneralId, {
                officerLevel: command.officerLevel,
                meta: { ...target!.meta, officerCity: command.destCityId },
            });
        }
    }

    await flushWorld(world, hooks);
    return { type: 'appoint', ok: true, generalId: command.generalId };
}

export const createTurnDaemonCommandHandler = (options: {
    world: InMemoryTurnWorld;
    hooks?: TurnDaemonHooks;
}): TurnDaemonCommandHandler => {
    const ctx = { world: options.world, hooks: options.hooks };

    return {
        handle: async (command): Promise<TurnDaemonCommandResult | null> => {
            switch (command.type) {
                case 'troopJoin':
                    return handleTroopJoin(ctx, command);
                case 'troopExit':
                    return handleTroopExit(ctx, command);
                case 'dieOnPrestart':
                    return handleDieOnPrestart(ctx, command);
                case 'buildNationCandidate':
                    return handleBuildNationCandidate(ctx, command);
                case 'instantRetreat':
                    return handleInstantRetreat(ctx, command);
                case 'vacation':
                    return handleVacation(ctx, command);
                case 'setMySetting':
                    return handleSetMySetting(ctx, command);
                case 'dropItem':
                    return handleDropItem(ctx, command);
                case 'changePermission':
                    return handleChangePermission(ctx, command);
                case 'kick':
                    return handleKick(ctx, command);
                case 'appoint':
                    return handleAppoint(ctx, command);
                default:
                    return null;
            }
        },
    };
};
