import type {
    TurnDaemonCommandHandler,
    TurnDaemonCommand,
    TurnDaemonCommandExecutionContext,
    TurnDaemonCommandResult,
} from '../lifecycle/types.js';
import type { GamePrisma } from '@sammo-ts/infra';
import { asRecord, JosaUtil, LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import {
    LogCategory,
    LogFormat,
    LogScope,
    ITEM_KEYS,
    buildVoteUniqueSeed,
    countOccupiedUniqueItems,
    createItemModuleRegistry,
    isValidTroopNameWidth,
    loadItemModules,
    normalizeTroopName,
    resolveTroopSecretPermission,
    resolveUniqueConfig,
    rollUniqueLottery,
    type ItemModule,
    type TriggerValue,
} from '@sammo-ts/logic';
import {
    cloneItemInventory,
    ensureItemInventory,
    equipNewItem,
    removeEquippedItem,
} from '@sammo-ts/logic/items/index.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { TurnGeneral } from './types.js';
import { openAuction } from '../auction/opener.js';

let itemRegistryPromise: Promise<Map<string, ItemModule>> | null = null;

const getItemRegistry = async (): Promise<Map<string, ItemModule>> => {
    if (!itemRegistryPromise) {
        itemRegistryPromise = loadItemModules([...ITEM_KEYS]).then((modules) => createItemModuleRegistry(modules));
    }
    return itemRegistryPromise;
};

const readMetaNumber = (meta: Record<string, unknown>, key: string, fallback: number): number => {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed);
        }
    }
    return fallback;
};

interface CommandHandlerContext {
    world: InMemoryTurnWorld;
    commandDb?: GamePrisma.TransactionClient;
    auctionFinalizer?: AuctionFinalizer;
    auctionBidder?: AuctionBidder;
    tournamentRewardFinalizer?: TournamentRewardFinalizer;
}

interface AuctionFinalizer {
    finalize(auctionId: number, db?: GamePrisma.TransactionClient): Promise<TurnDaemonCommandResult>;
}

interface AuctionBidder {
    bid(
        command: Extract<TurnDaemonCommand, { type: 'auctionBid' }>,
        db?: GamePrisma.TransactionClient
    ): Promise<TurnDaemonCommandResult>;
}

interface TournamentRewardFinalizer {
    finalize(
        command: Extract<TurnDaemonCommand, { type: 'tournamentReward' }>,
        db?: GamePrisma.TransactionClient
    ): Promise<TurnDaemonCommandResult>;
}

async function handleSetNationMeta(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'setNationMeta' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    const nation = world.getNationById(command.nationId);
    if (!nation) {
        return {
            type: 'setNationMeta',
            ok: false,
            nationId: command.nationId,
            reason: '국가 정보를 찾을 수 없습니다.',
        };
    }

    const meta = (nation.meta ?? {}) as Record<string, unknown>;
    const currentUpdatedAt = typeof meta._updatedAt === 'string' ? meta._updatedAt : undefined;
    if (command.expectedUpdatedAt && currentUpdatedAt && command.expectedUpdatedAt !== currentUpdatedAt) {
        return {
            type: 'setNationMeta',
            ok: false,
            nationId: command.nationId,
            reason: 'CONFLICT',
            currentUpdatedAt,
        };
    }

    const updatedAt = new Date().toISOString();
    const nextMeta = {
        ...meta,
        ...command.updates,
        _updatedAt: updatedAt,
    };

    world.updateNation(command.nationId, {
        meta: nextMeta,
    });
    return {
        type: 'setNationMeta',
        ok: true,
        nationId: command.nationId,
        updatedAt,
    };
}

async function handleAdjustGeneralResources(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'adjustGeneralResources' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    if (!command.adjustments || command.adjustments.length === 0) {
        return { type: 'adjustGeneralResources', ok: false, reason: '조정 대상이 없습니다.' };
    }

    const targets = command.adjustments.map((adjustment) => {
        const general = world.getGeneralById(adjustment.generalId);
        return { adjustment, general };
    });

    for (const { adjustment, general } of targets) {
        if (!general) {
            continue;
        }
        const nextGold = general.gold + (adjustment.goldDelta ?? 0);
        const nextRice = general.rice + (adjustment.riceDelta ?? 0);
        const minGoldAfter = adjustment.minGoldAfter ?? 0;
        if (nextGold < minGoldAfter || nextRice < 0) {
            return { type: 'adjustGeneralResources', ok: false, reason: '자원이 부족합니다.' };
        }
    }

    let processed = 0;
    let missing = 0;
    let totalGoldDelta = 0;
    let totalRiceDelta = 0;

    for (const { adjustment, general } of targets) {
        if (!general) {
            missing += 1;
            continue;
        }
        const goldDelta = adjustment.goldDelta ?? 0;
        const riceDelta = adjustment.riceDelta ?? 0;
        world.updateGeneral(adjustment.generalId, {
            gold: general.gold + goldDelta,
            rice: general.rice + riceDelta,
        });
        processed += 1;
        totalGoldDelta += goldDelta;
        totalRiceDelta += riceDelta;
    }
    return {
        type: 'adjustGeneralResources',
        ok: true,
        processed,
        missing,
        totalGoldDelta,
        totalRiceDelta,
    };
}

async function handleAdjustGeneralMeta(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'adjustGeneralMeta' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    if (!command.adjustments || command.adjustments.length === 0) {
        return {
            type: 'adjustGeneralMeta',
            ok: false,
            reason: '메타 조정 대상이 없습니다.',
        };
    }

    let processed = 0;
    let missing = 0;

    for (const adjustment of command.adjustments) {
        if (!adjustment || typeof adjustment.generalId !== 'number') {
            continue;
        }
        const general = world.getGeneralById(adjustment.generalId);
        if (!general) {
            missing += 1;
            continue;
        }
        const nextMeta = { ...general.meta } as TurnGeneral['meta'];
        for (const [key, delta] of Object.entries(adjustment.metaDelta ?? {})) {
            if (typeof delta !== 'number' || !Number.isFinite(delta)) {
                continue;
            }
            const current = typeof nextMeta[key] === 'number' ? Number(nextMeta[key]) : 0;
            nextMeta[key] = current + delta;
        }
        world.updateGeneral(adjustment.generalId, { meta: nextMeta });
        processed += 1;
    }
    return {
        type: 'adjustGeneralMeta',
        ok: true,
        processed,
        missing,
    };
}

async function handleTournamentMatchResult(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'tournamentMatchResult' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    const resolvePrefix = (type: number): string => {
        switch (type) {
            case 1:
                return 'tl';
            case 2:
                return 'ts';
            case 3:
                return 'ti';
            case 0:
            default:
                return 'tt';
        }
    };

    const prefix = resolvePrefix(command.tournamentType);
    const attacker = command.attackerId > 0 ? world.getGeneralById(command.attackerId) : null;
    const defender = command.defenderId > 0 ? world.getGeneralById(command.defenderId) : null;
    if (!attacker && !defender) {
        return {
            type: 'tournamentMatchResult',
            ok: false,
            tournamentType: command.tournamentType,
            attackerId: command.attackerId,
            defenderId: command.defenderId,
            result: command.result,
            reason: '장수 정보를 찾을 수 없습니다.',
        };
    }

    const rankKey = (suffix: string): string => `${prefix}${suffix}`;
    const getRankNumber = (general: TurnGeneral | null, key: string): number =>
        general && typeof general.meta[key] === 'number' ? Number(general.meta[key]) : 0;

    const attackerG = getRankNumber(attacker, rankKey('g'));
    const defenderG = getRankNumber(defender, rankKey('g'));

    let attackerGDelta = 0;
    let defenderGDelta = 0;
    let attackerW = 0;
    let attackerD = 0;
    let attackerL = 0;
    let defenderW = 0;
    let defenderD = 0;
    let defenderL = 0;

    if (command.result === 'attacker') {
        attackerW = 1;
        defenderL = 1;
        if (attackerG > defenderG) {
            attackerGDelta = 1;
            defenderGDelta = 0;
        } else if (attackerG === defenderG) {
            attackerGDelta = 2;
            defenderGDelta = -1;
        } else {
            attackerGDelta = 3;
            defenderGDelta = -2;
        }
    } else if (command.result === 'defender') {
        attackerL = 1;
        defenderW = 1;
        if (defenderG > attackerG) {
            defenderGDelta = 1;
            attackerGDelta = 0;
        } else if (attackerG === defenderG) {
            defenderGDelta = 2;
            attackerGDelta = -1;
        } else {
            defenderGDelta = 3;
            attackerGDelta = -2;
        }
    } else {
        attackerD = 1;
        defenderD = 1;
        if (attackerG > defenderG) {
            attackerGDelta = 1;
            defenderGDelta = -1;
        } else if (attackerG === defenderG) {
            attackerGDelta = 0;
            defenderGDelta = 0;
        } else {
            attackerGDelta = -1;
            defenderGDelta = 1;
        }
    }

    if (attacker) {
        const nextMeta = { ...attacker.meta } as TurnGeneral['meta'];
        nextMeta[rankKey('w')] = getRankNumber(attacker, rankKey('w')) + attackerW;
        nextMeta[rankKey('d')] = getRankNumber(attacker, rankKey('d')) + attackerD;
        nextMeta[rankKey('l')] = getRankNumber(attacker, rankKey('l')) + attackerL;
        nextMeta[rankKey('g')] = attackerG + attackerGDelta;
        world.updateGeneral(attacker.id, { meta: nextMeta });
    }

    if (defender) {
        const nextMeta = { ...defender.meta } as TurnGeneral['meta'];
        nextMeta[rankKey('w')] = getRankNumber(defender, rankKey('w')) + defenderW;
        nextMeta[rankKey('d')] = getRankNumber(defender, rankKey('d')) + defenderD;
        nextMeta[rankKey('l')] = getRankNumber(defender, rankKey('l')) + defenderL;
        nextMeta[rankKey('g')] = defenderG + defenderGDelta;
        world.updateGeneral(defender.id, { meta: nextMeta });
    }
    return {
        type: 'tournamentMatchResult',
        ok: true,
        tournamentType: command.tournamentType,
        attackerId: command.attackerId,
        defenderId: command.defenderId,
        result: command.result,
    };
}

async function handlePatchGeneral(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'patchGeneral' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return {
            type: 'patchGeneral',
            ok: false,
            generalId: command.generalId,
            reason: '장수 정보를 찾을 수 없습니다.',
        };
    }

    const patch: Partial<typeof general> = {};
    if (command.patch.meta) {
        patch.meta = {
            ...general.meta,
            ...command.patch.meta,
        } as TurnGeneral['meta'];
    }
    if (command.patch.turnTime) {
        const nextTurnTime = new Date(command.patch.turnTime);
        if (!Number.isNaN(nextTurnTime.getTime())) {
            patch.turnTime = nextTurnTime;
        }
    }
    if (command.patch.stats) {
        patch.stats = {
            ...general.stats,
            ...command.patch.stats,
        };
    }
    if (typeof command.patch.specialWar === 'string') {
        patch.role = {
            ...general.role,
            specialWar: command.patch.specialWar,
        };
    }

    world.updateGeneral(command.generalId, patch);
    return { type: 'patchGeneral', ok: true, generalId: command.generalId };
}

async function handleTroopJoin(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'troopJoin' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
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
    return {
        type: 'troopJoin',
        ok: true,
        generalId: command.generalId,
        troopId: command.troopId,
    };
}

async function handleTroopCreate(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'troopCreate' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return {
            type: 'troopCreate',
            ok: false,
            generalId: command.generalId,
            reason: '장수 정보를 찾을 수 없습니다.',
        };
    }

    const troopName = normalizeTroopName(command.troopName);
    if (!troopName) {
        return { type: 'troopCreate', ok: false, generalId: command.generalId, reason: '부대 이름이 없습니다.' };
    }
    if (!isValidTroopNameWidth(troopName)) {
        return {
            type: 'troopCreate',
            ok: false,
            generalId: command.generalId,
            reason: '부대 이름은 전각 9자 또는 반각 18자 이하여야 합니다.',
        };
    }
    if (general.troopId !== 0 || world.getTroopById(general.id)) {
        return {
            type: 'troopCreate',
            ok: false,
            generalId: command.generalId,
            reason: '이미 부대에 소속되어 있습니다.',
        };
    }
    if (general.nationId <= 0 || !world.getNationById(general.nationId)) {
        return {
            type: 'troopCreate',
            ok: false,
            generalId: command.generalId,
            reason: '국가에 소속되어 있지 않습니다.',
        };
    }

    const troop = world.createTroop({
        id: general.id,
        nationId: general.nationId,
        name: troopName,
    });
    if (!troop) {
        return {
            type: 'troopCreate',
            ok: false,
            generalId: command.generalId,
            reason: '부대가 생성되지 않았습니다. 버그일 수 있습니다.',
        };
    }
    world.updateGeneral(general.id, { troopId: general.id });
    return {
        type: 'troopCreate',
        ok: true,
        generalId: general.id,
        troopId: troop.id,
        troopName: troop.name,
    };
}

async function handleTroopExit(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'troopExit' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
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
    return {
        type: 'troopExit',
        ok: true,
        generalId: command.generalId,
        wasLeader: true,
    };
}

async function handleTroopKick(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'troopKick' }>
): Promise<TurnDaemonCommandResult> {
    const fail = (reason: string): TurnDaemonCommandResult => ({
        type: 'troopKick',
        ok: false,
        generalId: command.generalId,
        troopId: command.troopId,
        targetGeneralId: command.targetGeneralId,
        reason,
    });
    const { world } = ctx;
    const actor = world.getGeneralById(command.generalId);
    if (!actor) {
        return fail('장수 정보를 찾을 수 없습니다.');
    }
    const troop = world.getTroopById(command.troopId);
    if (
        command.generalId !== command.troopId ||
        actor.troopId !== actor.id ||
        !troop ||
        troop.id !== actor.id ||
        troop.nationId !== actor.nationId
    ) {
        return fail('권한이 부족합니다.');
    }

    const target = world.getGeneralById(command.targetGeneralId);
    if (!target) {
        return fail('장수 정보를 찾을 수 없습니다.');
    }
    if (target.troopId === 0) {
        return fail('부대에 소속되어 있지 않습니다.');
    }
    if (target.troopId !== command.troopId) {
        return fail('다른 부대에 소속되어 있습니다.');
    }
    if (target.id === command.troopId) {
        return fail('부대장을 추방할 수 없습니다.');
    }

    world.updateGeneral(target.id, { troopId: 0 });
    return {
        type: 'troopKick',
        ok: true,
        generalId: actor.id,
        troopId: troop.id,
        targetGeneralId: target.id,
    };
}

async function handleTroopRename(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'troopRename' }>
): Promise<TurnDaemonCommandResult> {
    const fail = (reason: string): TurnDaemonCommandResult => ({
        type: 'troopRename',
        ok: false,
        generalId: command.generalId,
        troopId: command.troopId,
        reason,
    });
    const { world } = ctx;
    const actor = world.getGeneralById(command.generalId);
    if (!actor) {
        return fail('장수 정보를 찾을 수 없습니다.');
    }

    const nation = world.getNationById(actor.nationId);
    const permission = resolveTroopSecretPermission(actor, nation?.meta ?? {}, false);
    if (actor.id !== command.troopId && permission < 4) {
        return fail('권한이 부족합니다.');
    }

    const troopName = normalizeTroopName(command.troopName);
    if (!troopName) {
        return fail('부대 이름이 없습니다.');
    }
    if (!isValidTroopNameWidth(troopName)) {
        return fail('부대 이름은 전각 9자 또는 반각 18자 이하여야 합니다.');
    }

    const troop = world.getTroopById(command.troopId);
    if (!troop || actor.nationId <= 0 || troop.nationId !== actor.nationId) {
        return fail('부대가 없습니다.');
    }
    world.updateTroop(troop.id, { name: troopName });
    return {
        type: 'troopRename',
        ok: true,
        generalId: actor.id,
        troopId: troop.id,
        troopName,
    };
}

async function handleDieOnPrestart(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'dieOnPrestart' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
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
    const { world } = ctx;
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
    return { type: 'setMySetting', ok: true, generalId: command.generalId };
}

async function handleDropItem(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'dropItem' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return { type: 'dropItem', ok: false, generalId: command.generalId, reason: '장수 정보를 찾을 수 없습니다.' };
    }
    const slot = (['horse', 'weapon', 'book', 'item'] as const).find(
        (candidate) => general.role.items[candidate] === command.itemType
    );
    if (!slot) {
        return { type: 'dropItem', ok: false, generalId: command.generalId, reason: '아이템을 가지고 있지 않습니다.' };
    }
    const nextGeneral = {
        ...general,
        role: { ...general.role, items: { ...general.role.items } },
        itemInventory: cloneItemInventory(ensureItemInventory(general)),
    };
    removeEquippedItem(nextGeneral, slot);

    world.updateGeneral(command.generalId, {
        role: nextGeneral.role,
        itemInventory: nextGeneral.itemInventory,
    });
    return { type: 'dropItem', ok: true, generalId: command.generalId };
}

async function handleAuctionFinalize(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'auctionFinalize' }>
): Promise<TurnDaemonCommandResult> {
    if (!ctx.auctionFinalizer) {
        return {
            type: 'auctionFinalize',
            ok: false,
            auctionId: command.auctionId,
            reason: '경매 확정기가 준비되지 않았습니다.',
        };
    }
    return ctx.auctionFinalizer.finalize(command.auctionId, ctx.commandDb);
}

async function handleAuctionOpen(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'auctionOpen' }>
): Promise<TurnDaemonCommandResult> {
    return openAuction(command, ctx.world, ctx.commandDb);
}

async function handleAuctionBid(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'auctionBid' }>
): Promise<TurnDaemonCommandResult> {
    if (!ctx.auctionBidder) {
        return {
            type: 'auctionBid',
            ok: false,
            auctionId: command.auctionId,
            reason: '경매 입찰기가 준비되지 않았습니다.',
        };
    }
    return ctx.auctionBidder.bid(command, ctx.commandDb);
}

async function handleChangePermission(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'changePermission' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
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
    return { type: 'changePermission', ok: true, generalId: command.generalId };
}

async function handleKick(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'kick' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
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
    return { type: 'kick', ok: true, generalId: command.generalId };
}

async function handleAppoint(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'appoint' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
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
    return { type: 'appoint', ok: true, generalId: command.generalId };
}

async function handleTournamentRefund(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'tournamentRefund' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    if (!command.refunds || command.refunds.length === 0) {
        return {
            type: 'tournamentRefund',
            ok: false,
            bettingId: command.bettingId,
            reason: '환불 대상이 없습니다.',
        };
    }

    let processed = 0;
    let missing = 0;
    let totalRefund = 0;

    for (const refund of command.refunds) {
        if (!refund || typeof refund.generalId !== 'number' || typeof refund.amount !== 'number') {
            continue;
        }
        if (refund.amount <= 0) {
            continue;
        }
        const general = world.getGeneralById(refund.generalId);
        if (!general) {
            missing += 1;
            continue;
        }
        world.updateGeneral(refund.generalId, {
            gold: general.gold + refund.amount,
        });
        processed += 1;
        totalRefund += refund.amount;
    }
    return {
        type: 'tournamentRefund',
        ok: true,
        bettingId: command.bettingId,
        processed,
        missing,
        totalRefund,
    };
}

async function handleTournamentBettingPayout(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'tournamentBettingPayout' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    if (!command.payouts || command.payouts.length === 0) {
        return {
            type: 'tournamentBettingPayout',
            ok: false,
            bettingId: command.bettingId,
            reason: '정산 대상이 없습니다.',
        };
    }

    let processed = 0;
    let missing = 0;
    let totalPayout = 0;
    const metaDeltas = new Map<number, { betwin: number; betwingold: number }>();

    for (const payout of command.payouts) {
        if (!payout || typeof payout.generalId !== 'number' || typeof payout.amount !== 'number') {
            continue;
        }
        if (payout.amount <= 0) {
            continue;
        }
        const general = world.getGeneralById(payout.generalId);
        if (!general) {
            missing += 1;
            continue;
        }
        world.updateGeneral(payout.generalId, {
            gold: general.gold + payout.amount,
        });
        processed += 1;
        totalPayout += payout.amount;
        const currentDelta = metaDeltas.get(payout.generalId) ?? { betwin: 0, betwingold: 0 };
        metaDeltas.set(payout.generalId, {
            betwin: currentDelta.betwin + 1,
            betwingold: currentDelta.betwingold + payout.amount,
        });
    }

    for (const [generalId, delta] of metaDeltas) {
        const general = world.getGeneralById(generalId);
        if (!general) {
            continue;
        }
        const nextMeta = { ...general.meta } as TurnGeneral['meta'];
        const betwinKey = 'betwin';
        const betwingoldKey = 'betwingold';
        const currentBetwin = typeof nextMeta[betwinKey] === 'number' ? Number(nextMeta[betwinKey]) : 0;
        const currentBetwingold = typeof nextMeta[betwingoldKey] === 'number' ? Number(nextMeta[betwingoldKey]) : 0;
        nextMeta[betwinKey] = currentBetwin + delta.betwin;
        nextMeta[betwingoldKey] = currentBetwingold + delta.betwingold;
        world.updateGeneral(generalId, { meta: nextMeta });
    }
    return {
        type: 'tournamentBettingPayout',
        ok: true,
        bettingId: command.bettingId,
        processed,
        missing,
        totalPayout,
    };
}

async function handleTournamentReward(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'tournamentReward' }>
): Promise<TurnDaemonCommandResult> {
    if (!ctx.tournamentRewardFinalizer) {
        return {
            type: 'tournamentReward',
            ok: false,
            winnerId: command.winnerId,
            runnerUpId: command.runnerUpId,
            reason: '보상 처리기가 준비되지 않았습니다.',
        };
    }
    return ctx.tournamentRewardFinalizer.finalize(command, ctx.commandDb);
}

// 설문 보상은 API에서 전달된 RNG 결과를 재검증한 뒤 월드에 반영한다.
async function handleVoteReward(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'voteReward' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return {
            type: 'voteReward',
            ok: false,
            voteId: command.voteId,
            generalId: command.generalId,
            reason: '장수 정보를 찾을 수 없습니다.',
        };
    }

    const baseMeta = general.meta;
    const metaRecord = asRecord(baseMeta);
    const existingRewards = asRecord(metaRecord.voteRewards);
    const rewardKey = String(command.voteId);
    if (Object.prototype.hasOwnProperty.call(existingRewards, rewardKey)) {
        const existingValue = existingRewards[rewardKey];
        const existingEntry = asRecord(existingValue);
        const existingItemKey = typeof existingEntry.itemKey === 'string' ? existingEntry.itemKey : null;
        const awarded = existingEntry.awarded === true || Boolean(existingItemKey);
        return {
            type: 'voteReward',
            ok: true,
            voteId: command.voteId,
            generalId: command.generalId,
            awardedUnique: awarded,
            itemKey: existingItemKey ?? null,
            alreadyApplied: true,
        };
    }

    const worldState = world.getState();
    const worldMeta = asRecord(worldState.meta);
    const scenarioMeta = asRecord(worldMeta.scenarioMeta);
    const startYear = readMetaNumber(scenarioMeta, 'startYear', worldState.currentYear);
    const initYear = readMetaNumber(worldMeta, 'initYear', startYear);
    const initMonth = readMetaNumber(worldMeta, 'initMonth', 1);
    const scenarioId = readMetaNumber(worldMeta, 'scenarioId', 0);
    const hiddenSeed = worldMeta.hiddenSeed ?? worldMeta.seed ?? worldState.id;

    const itemRegistry = await getItemRegistry();
    const configConst = asRecord(world.getScenarioConfig().const);
    const uniqueConfig = resolveUniqueConfig(configConst);
    const generals = world.listGenerals();
    const occupiedUniqueCounts = countOccupiedUniqueItems(
        generals.map((entry) => entry.role.items),
        itemRegistry
    );
    const userCount = generals.filter((entry) => entry.npcState < 2).length;
    const rngSeed = buildVoteUniqueSeed(
        typeof hiddenSeed === 'string' || typeof hiddenSeed === 'number' ? hiddenSeed : String(hiddenSeed),
        command.voteId,
        command.generalId
    );
    const rng = new RandUtil(LiteHashDRBG.build(rngSeed));
    const itemKey = rollUniqueLottery({
        rng,
        config: uniqueConfig,
        itemRegistry,
        generalItems: general.role.items,
        occupiedUniqueCounts,
        scenarioId,
        userCount,
        currentYear: worldState.currentYear,
        currentMonth: worldState.currentMonth,
        startYear,
        initYear,
        initMonth,
        acquireType: '설문조사',
    });

    const expectedUnique = command.unique?.expected ?? false;
    const expectedItemKey = command.unique?.itemKey ?? null;
    if (expectedUnique !== Boolean(itemKey)) {
        return {
            type: 'voteReward',
            ok: false,
            voteId: command.voteId,
            generalId: command.generalId,
            reason: '유니크 판정이 일치하지 않습니다.',
        };
    }
    if (expectedUnique) {
        if (!expectedItemKey || !itemKey || expectedItemKey !== itemKey) {
            return {
                type: 'voteReward',
                ok: false,
                voteId: command.voteId,
                generalId: command.generalId,
                reason: '유니크 판정이 일치하지 않습니다.',
            };
        }
    } else if (itemKey) {
        return {
            type: 'voteReward',
            ok: false,
            voteId: command.voteId,
            generalId: command.generalId,
            reason: '유니크 판정이 일치하지 않습니다.',
        };
    }

    const rewardEntry: Record<string, TriggerValue> = {
        awarded: Boolean(itemKey),
        at: new Date().toISOString(),
    };
    if (itemKey) {
        rewardEntry.itemKey = itemKey;
    }

    const nextVoteRewards: Record<string, TriggerValue> = {
        ...(existingRewards as Record<string, TriggerValue>),
        [rewardKey]: rewardEntry,
    };

    const nextMeta: TurnGeneral['meta'] = {
        ...baseMeta,
        voteRewards: nextVoteRewards,
    };

    const patch: Partial<TurnGeneral> = {
        gold: general.gold + command.goldReward,
        meta: nextMeta,
    };

    if (itemKey) {
        const itemModule = itemRegistry.get(itemKey);
        if (!itemModule) {
            return {
                type: 'voteReward',
                ok: false,
                voteId: command.voteId,
                generalId: command.generalId,
                reason: '유니크 아이템을 찾을 수 없습니다.',
            };
        }
        const nextGeneral = {
            ...general,
            role: { ...general.role, items: { ...general.role.items } },
            itemInventory: cloneItemInventory(ensureItemInventory(general)),
        };
        equipNewItem(nextGeneral, itemModule.slot, itemKey, {
            ...(itemModule.initialCharges === undefined ? {} : { charges: itemModule.initialCharges }),
        });
        patch.role = nextGeneral.role;
        patch.itemInventory = nextGeneral.itemInventory;

        const nationName = world.getNationById(general.nationId)?.name ?? '재야';
        const generalName = general.name;
        const itemName = itemModule.name;
        const itemRawName = itemModule.rawName;
        const josaYi = JosaUtil.pick(generalName, '이');
        const josaUl = JosaUtil.pick(itemRawName, '을');

        world.pushLog({
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
            text: `<C>${itemName}</>${josaUl} 습득했습니다!`,
            generalId: general.id,
            meta: {},
        });
        world.pushLog({
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
            text: `<C>${itemName}</>${josaUl} 습득`,
            generalId: general.id,
            meta: {},
        });
        world.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.SUMMARY,
            format: LogFormat.MONTH,
            text: `<Y>${generalName}</>${josaYi} <C>${itemName}</>${josaUl} 습득했습니다!`,
            meta: {},
        });
        world.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
            text: `<C><b>【설문조사】</b></><D><b>${nationName}</b></>의 <Y>${generalName}</>${josaYi} <C>${itemName}</>${josaUl} 습득했습니다!`,
            meta: {},
        });
    }

    world.updateGeneral(command.generalId, patch);
    return {
        type: 'voteReward',
        ok: true,
        voteId: command.voteId,
        generalId: command.generalId,
        awardedUnique: Boolean(itemKey),
        ...(itemKey ? { itemKey } : {}),
    };
}

export const createTurnDaemonCommandHandler = (options: {
    world: InMemoryTurnWorld;
    auctionFinalizer?: AuctionFinalizer;
    auctionBidder?: AuctionBidder;
    tournamentRewardFinalizer?: TournamentRewardFinalizer;
}): TurnDaemonCommandHandler => {
    const ctx: CommandHandlerContext = {
        world: options.world,
        auctionFinalizer: options.auctionFinalizer,
        auctionBidder: options.auctionBidder,
        tournamentRewardFinalizer: options.tournamentRewardFinalizer,
    };

    type HandlerMap = Partial<
        Record<TurnDaemonCommand['type'], (command: TurnDaemonCommand) => Promise<TurnDaemonCommandResult>>
    >;

    const handlers: HandlerMap = {
        troopCreate: (command) =>
            handleTroopCreate(ctx, command as Extract<TurnDaemonCommand, { type: 'troopCreate' }>),
        troopJoin: (command) => handleTroopJoin(ctx, command as Extract<TurnDaemonCommand, { type: 'troopJoin' }>),
        troopExit: (command) => handleTroopExit(ctx, command as Extract<TurnDaemonCommand, { type: 'troopExit' }>),
        troopKick: (command) => handleTroopKick(ctx, command as Extract<TurnDaemonCommand, { type: 'troopKick' }>),
        troopRename: (command) =>
            handleTroopRename(ctx, command as Extract<TurnDaemonCommand, { type: 'troopRename' }>),
        dieOnPrestart: (command) =>
            handleDieOnPrestart(ctx, command as Extract<TurnDaemonCommand, { type: 'dieOnPrestart' }>),
        buildNationCandidate: (command) =>
            handleBuildNationCandidate(ctx, command as Extract<TurnDaemonCommand, { type: 'buildNationCandidate' }>),
        instantRetreat: (command) =>
            handleInstantRetreat(ctx, command as Extract<TurnDaemonCommand, { type: 'instantRetreat' }>),
        vacation: (command) => handleVacation(ctx, command as Extract<TurnDaemonCommand, { type: 'vacation' }>),
        setMySetting: (command) =>
            handleSetMySetting(ctx, command as Extract<TurnDaemonCommand, { type: 'setMySetting' }>),
        dropItem: (command) => handleDropItem(ctx, command as Extract<TurnDaemonCommand, { type: 'dropItem' }>),
        auctionFinalize: (command) =>
            handleAuctionFinalize(ctx, command as Extract<TurnDaemonCommand, { type: 'auctionFinalize' }>),
        auctionOpen: (command) =>
            handleAuctionOpen(ctx, command as Extract<TurnDaemonCommand, { type: 'auctionOpen' }>),
        auctionBid: (command) => handleAuctionBid(ctx, command as Extract<TurnDaemonCommand, { type: 'auctionBid' }>),
        changePermission: (command) =>
            handleChangePermission(ctx, command as Extract<TurnDaemonCommand, { type: 'changePermission' }>),
        kick: (command) => handleKick(ctx, command as Extract<TurnDaemonCommand, { type: 'kick' }>),
        appoint: (command) => handleAppoint(ctx, command as Extract<TurnDaemonCommand, { type: 'appoint' }>),
        tournamentRefund: (command) =>
            handleTournamentRefund(ctx, command as Extract<TurnDaemonCommand, { type: 'tournamentRefund' }>),
        tournamentBettingPayout: (command) =>
            handleTournamentBettingPayout(
                ctx,
                command as Extract<TurnDaemonCommand, { type: 'tournamentBettingPayout' }>
            ),
        tournamentReward: (command) =>
            handleTournamentReward(ctx, command as Extract<TurnDaemonCommand, { type: 'tournamentReward' }>),
        voteReward: (command) => handleVoteReward(ctx, command as Extract<TurnDaemonCommand, { type: 'voteReward' }>),
        setNationMeta: (command) =>
            handleSetNationMeta(ctx, command as Extract<TurnDaemonCommand, { type: 'setNationMeta' }>),
        adjustGeneralResources: (command) =>
            handleAdjustGeneralResources(
                ctx,
                command as Extract<TurnDaemonCommand, { type: 'adjustGeneralResources' }>
            ),
        adjustGeneralMeta: (command) =>
            handleAdjustGeneralMeta(ctx, command as Extract<TurnDaemonCommand, { type: 'adjustGeneralMeta' }>),
        tournamentMatchResult: (command) =>
            handleTournamentMatchResult(ctx, command as Extract<TurnDaemonCommand, { type: 'tournamentMatchResult' }>),
        patchGeneral: (command) =>
            handlePatchGeneral(ctx, command as Extract<TurnDaemonCommand, { type: 'patchGeneral' }>),
    };

    return {
        handle: async (
            command,
            executionContext?: TurnDaemonCommandExecutionContext
        ): Promise<TurnDaemonCommandResult | null> => {
            const handler = handlers[command.type];
            if (!handler) {
                return null;
            }
            ctx.commandDb = executionContext?.db;
            try {
                return await handler(command);
            } finally {
                ctx.commandDb = undefined;
            }
        },
    };
};
