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
    addOccupiedUniqueItemKeys,
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
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';
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

const hasOfficerLock = (meta: Record<string, unknown>, key: string, officerLevel: number): boolean =>
    (readMetaNumber(meta, key, 0) & (1 << officerLevel)) !== 0;

const setOfficerLock = (
    meta: Record<string, TriggerValue>,
    key: string,
    officerLevel: number
): Record<string, TriggerValue> => ({
    ...meta,
    [key]: readMetaNumber(meta, key, 0) | (1 << officerLevel),
});

const resolveNationChiefLevel = (nationLevel: number): number => {
    if (nationLevel >= 6) return 5;
    if (nationLevel >= 4) return 7;
    if (nationLevel >= 2) return 9;
    return 11;
};

const resolvePermissionKind = (general: TurnGeneral): 'normal' | 'ambassador' | 'auditor' => {
    const permission = general.meta.permission;
    return permission === 'ambassador' || permission === 'auditor' ? permission : 'normal';
};

const resolveMaxSecretPermission = (general: TurnGeneral): number => {
    const penalty = asRecord(general.penalty);
    if (penalty.noTopSecret || penalty.noChief) return 1;
    if (penalty.noAmbassador) return 2;
    return 4;
};

const refreshActorKillturn = (world: InMemoryTurnWorld, actor: TurnGeneral): void => {
    const worldKillturn = readMetaNumber(asRecord(world.getState().meta), 'killturn', 0);
    const actorKillturn = readMetaNumber(asRecord(actor.meta), 'killturn', 0);
    if (worldKillturn <= actorKillturn) {
        return;
    }
    world.updateGeneral(actor.id, {
        meta: {
            ...actor.meta,
            killturn: worldKillturn,
        },
    });
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
        if (nextGold < 0 || nextRice < 0) {
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

    const rankKey = (suffix: string): string => `rank_${prefix}${suffix}`;
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
    if (!nation || general.officerLevel !== 12 || nation.chiefGeneralId !== general.id) {
        return { type: 'changePermission', ok: false, generalId: command.generalId, reason: '군주가 아닙니다.' };
    }

    const uniqueTargetIds = [...new Set(command.targetGeneralIds)];
    if (uniqueTargetIds.length > 2) {
        return {
            type: 'changePermission',
            ok: false,
            generalId: command.generalId,
            reason: command.isAmbassador
                ? '외교권자는 최대 둘까지만 설정 가능합니다.'
                : '조언자는 최대 둘까지만 설정 가능합니다.',
        };
    }

    const targetType = command.isAmbassador ? 'ambassador' : 'auditor';
    const requiredPermission = command.isAmbassador ? 4 : 3;
    const targets: TurnGeneral[] = [];
    for (const targetId of uniqueTargetIds) {
        const target = world.getGeneralById(targetId);
        if (
            !target ||
            target.nationId !== general.nationId ||
            target.officerLevel === 12 ||
            !['normal', targetType].includes(resolvePermissionKind(target)) ||
            resolveMaxSecretPermission(target) < requiredPermission
        ) {
            continue;
        }
        targets.push(target);
    }

    for (const candidate of world.listGenerals()) {
        if (candidate.nationId !== general.nationId || resolvePermissionKind(candidate) !== targetType) {
            continue;
        }
        world.updateGeneral(candidate.id, {
            meta: {
                ...candidate.meta,
                permission: 'normal',
            },
        });
    }
    for (const target of targets) {
        world.updateGeneral(target.id, {
            meta: {
                ...target.meta,
                permission: targetType,
            },
        });
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
    if (!nation || general.officerLevel < 5) {
        return { type: 'kick', ok: false, generalId: command.generalId, reason: '수뇌가 아닙니다.' };
    }
    const actorPenalty = asRecord(general.penalty);
    if (actorPenalty.noBanGeneral) {
        return { type: 'kick', ok: false, generalId: command.generalId, reason: '추방할 수 없는 상태입니다.' };
    }
    if (hasOfficerLock(asRecord(nation.meta), 'chief_set', general.officerLevel)) {
        return {
            type: 'kick',
            ok: false,
            generalId: command.generalId,
            reason: '이미 추방 권한을 사용했습니다.',
        };
    }

    const target = world.getGeneralById(command.destGeneralId);
    if (!target || target.id === general.id || target.nationId !== general.nationId) {
        return {
            type: 'kick',
            ok: false,
            generalId: command.generalId,
            reason: '대상을 찾을 수 없거나 같은 국가가 아닙니다.',
        };
    }
    if (resolveMaxSecretPermission(target) === 4 && resolvePermissionKind(target) === 'ambassador') {
        return {
            type: 'kick',
            ok: false,
            generalId: command.generalId,
            reason: '외교권자는 추방할 수 없습니다.',
        };
    }

    const config = asRecord(world.getScenarioConfig().const);
    const defaultGold = readMetaNumber(config, 'defaultGold', 1000);
    const defaultRice = readMetaNumber(config, 'defaultRice', 1000);
    const returnedGold = Math.max(0, target.gold - defaultGold);
    const returnedRice = Math.max(0, target.rice - defaultRice);
    const targetMeta = target.meta;
    const nextMeta: TurnGeneral['meta'] = {
        ...targetMeta,
        officerCity: 0,
        officer_city: 0,
        belong: 0,
        makelimit: 12,
        permission: 'normal',
    };

    const worldState = world.getState();
    const scenarioMeta = asRecord(asRecord(worldState.meta).scenarioMeta);
    const startYear = readMetaNumber(scenarioMeta, 'startYear', worldState.currentYear);
    if (worldState.currentYear > startYear || target.npcState >= 2) {
        const betray = Math.max(0, readMetaNumber(targetMeta, 'betray', 0));
        const maxBetrayCnt = readMetaNumber(config, 'maxBetrayCnt', 9);
        nextMeta.betray = Math.min(maxBetrayCnt, betray + 1);
        world.updateGeneral(target.id, {
            experience: Math.max(0, Math.floor(target.experience - target.experience * 0.15 * betray)),
            dedication: Math.max(0, Math.floor(target.dedication - target.dedication * 0.15 * betray)),
        });
    } else {
        nextMeta.makelimit = targetMeta.makelimit ?? 12;
    }
    if (worldState.currentYear < startYear + 3) {
        const ruler = world.getGeneralById(nation.chiefGeneralId ?? 0);
        if (ruler) {
            world.updateGeneral(ruler.id, { injury: Math.min(80, ruler.injury + 1) });
        }
    }

    if (target.troopId === target.id) {
        for (const member of world.listGenerals()) {
            if (member.troopId === target.id) {
                world.updateGeneral(member.id, { troopId: 0 });
            }
        }
        world.removeTroop(target.id);
    }

    world.updateGeneral(command.destGeneralId, {
        nationId: 0,
        officerLevel: 0,
        troopId: 0,
        gold: Math.min(target.gold, defaultGold),
        rice: Math.min(target.rice, defaultRice),
        meta: nextMeta,
    });
    const nationMeta =
        worldState.currentYear >= startYear + 3
            ? setOfficerLock(nation.meta, 'chief_set', general.officerLevel)
            : { ...nation.meta };
    nationMeta.gennum = Math.max(0, readMetaNumber(nation.meta, 'gennum', 0) - (target.npcState !== 5 ? 1 : 0));
    world.updateNation(nation.id, {
        gold: nation.gold + returnedGold,
        rice: nation.rice + returnedRice,
        meta: nationMeta,
    });
    refreshActorKillturn(world, general);

    const josaYi = JosaUtil.pick(target.name, '이');
    world.pushLog({
        scope: LogScope.SYSTEM,
        category: LogCategory.SUMMARY,
        format: LogFormat.MONTH,
        text: `<Y>${target.name}</>${josaYi} <D><b>${nation.name}</b></>에서 <R>추방</>당했습니다.`,
        meta: {},
    });
    world.pushLog({
        scope: LogScope.GENERAL,
        category: LogCategory.HISTORY,
        format: LogFormat.YEAR_MONTH,
        text: `<D>${nation.name}</>에서 추방됨`,
        generalId: target.id,
        meta: {},
    });
    if (target.npcState >= 2) {
        const worldMeta = asRecord(worldState.meta);
        const hiddenSeed = worldMeta.hiddenSeed ?? worldMeta.seed ?? worldState.id;
        const rng = new RandUtil(
            new LiteHashDRBG(
                simpleSerialize(
                    typeof hiddenSeed === 'string' || typeof hiddenSeed === 'number' ? hiddenSeed : String(hiddenSeed),
                    'BanNPC',
                    worldState.currentYear,
                    worldState.currentMonth,
                    target.id
                )
            )
        );
        const npcBanMessageProb = readMetaNumber(config, 'npcBanMessageProb', 0.01);
        if (rng.nextBool(npcBanMessageProb)) {
            const text = rng.choice([
                '날 버리다니... 곧 전장에서 복수해주겠다...',
                '추방이라... 내가 무얼 잘못했단 말인가...',
                '어디 추방해가면서 잘되나 보자... 꼭 복수하겠다.',
                '인덕이 제일이거늘... 추방이 웬말인가... 저주한다!',
                '날 추방했으니 그 복수로 적국에 정보를 팔아 넘겨야겠군요. 그럼 이만.',
            ]);
            const messageTarget = {
                generalId: target.id,
                generalName: target.name,
                nationId: nation.id,
                nationName: nation.name,
                color: nation.color,
                icon: target.picture === null ? '' : String(target.picture),
            };
            world.queueMessage({
                msgType: 'public',
                src: messageTarget,
                dest: messageTarget,
                text,
                time: new Date(),
                validUntil: new Date('9999-12-31T00:00:00.000Z'),
                option: {},
            });
        }
    }
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
    if (!nation || general.officerLevel < 5) {
        return { type: 'appoint', ok: false, generalId: command.generalId, reason: '수뇌가 아닙니다.' };
    }
    const actorPenalty = asRecord(general.penalty);
    if (command.officerLevel === 12) {
        return {
            type: 'appoint',
            ok: false,
            generalId: command.generalId,
            reason: '군주를 대상으로 할 수 없습니다.',
        };
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

    if (command.officerLevel >= 5 && command.officerLevel < 12) {
        if (actorPenalty.noChiefChange) {
            return {
                type: 'appoint',
                ok: false,
                generalId: command.generalId,
                reason: '수뇌를 임명할 수 없는 상태입니다.',
            };
        }
        const minLevel = resolveNationChiefLevel(nation.level);
        if (command.officerLevel < minLevel) {
            return {
                type: 'appoint',
                ok: false,
                generalId: command.generalId,
                reason: '임명불가능한 관직입니다.',
            };
        }
        if (hasOfficerLock(asRecord(nation.meta), 'chief_set', command.officerLevel)) {
            return {
                type: 'appoint',
                ok: false,
                generalId: command.generalId,
                reason: '지금은 임명할 수 없습니다.',
            };
        }
        if (target) {
            const targetPenalty = asRecord(target.penalty);
            if (targetPenalty.noChief) {
                return {
                    type: 'appoint',
                    ok: false,
                    generalId: command.generalId,
                    reason: '수뇌가 될 수 없는 상태입니다.',
                };
            }
            const chiefStatMin = world.getScenarioConfig().stat.chiefMin;
            if (command.officerLevel !== 11 && command.officerLevel % 2 === 0 && target.stats.strength < chiefStatMin) {
                return { type: 'appoint', ok: false, generalId: command.generalId, reason: '무력이 부족합니다.' };
            }
            if (
                command.officerLevel !== 11 &&
                command.officerLevel % 2 === 1 &&
                target.stats.intelligence < chiefStatMin
            ) {
                return { type: 'appoint', ok: false, generalId: command.generalId, reason: '지력이 부족합니다.' };
            }
        }
        for (const g of world.listGenerals()) {
            if (g.nationId === general.nationId && g.officerLevel === command.officerLevel) {
                world.updateGeneral(g.id, {
                    officerLevel: 1,
                    meta: { ...g.meta, officerCity: 0, officer_city: 0 },
                });
            }
        }
        if (command.destGeneralId !== 0) {
            world.updateGeneral(command.destGeneralId, {
                officerLevel: command.officerLevel,
                meta: { ...target!.meta, officerCity: 0, officer_city: 0 },
            });
        }
        world.updateNation(nation.id, {
            meta: setOfficerLock(nation.meta, 'chief_set', command.officerLevel),
        });
    } else if (command.officerLevel >= 2 && command.officerLevel <= 4) {
        const city = world.getCityById(command.destCityId);
        if (!city || city.nationId !== general.nationId) {
            return {
                type: 'appoint',
                ok: false,
                generalId: command.generalId,
                reason: '도시를 찾을 수 없거나 아군 도시가 아닙니다.',
            };
        }
        if (hasOfficerLock(asRecord(city.meta), 'officer_set', command.officerLevel)) {
            return {
                type: 'appoint',
                ok: false,
                generalId: command.generalId,
                reason: '이미 다른 장수가 임명되어있습니다.',
            };
        }
        if (target && target.officerLevel >= 4 && actorPenalty.noChiefChange) {
            return {
                type: 'appoint',
                ok: false,
                generalId: command.generalId,
                reason: '수뇌인 장수를 변경할 수 없는 상태입니다.',
            };
        }
        const chiefStatMin = world.getScenarioConfig().stat.chiefMin;
        if (target && command.officerLevel === 4 && target.stats.strength < chiefStatMin) {
            return { type: 'appoint', ok: false, generalId: command.generalId, reason: '무력이 부족합니다.' };
        }
        if (target && command.officerLevel === 3 && target.stats.intelligence < chiefStatMin) {
            return { type: 'appoint', ok: false, generalId: command.generalId, reason: '지력이 부족합니다.' };
        }
        for (const g of world.listGenerals()) {
            if (
                g.nationId === general.nationId &&
                g.meta.officerCity === command.destCityId &&
                g.officerLevel === command.officerLevel
            ) {
                world.updateGeneral(g.id, {
                    officerLevel: 1,
                    meta: { ...g.meta, officerCity: 0, officer_city: 0 },
                });
            }
        }
        if (command.destGeneralId !== 0) {
            world.updateGeneral(command.destGeneralId, {
                officerLevel: command.officerLevel,
                meta: { ...target!.meta, officerCity: command.destCityId, officer_city: command.destCityId },
            });
        }
        world.updateCity(city.id, {
            meta: setOfficerLock(city.meta, 'officer_set', command.officerLevel),
        });
    } else {
        return { type: 'appoint', ok: false, generalId: command.generalId, reason: '올바르지 않은 지정입니다.' };
    }
    refreshActorKillturn(world, general);
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
        const betwinKey = 'rank_betwin';
        const betwingoldKey = 'rank_betwingold';
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
    if (ctx.commandDb) {
        const reservedUniqueRows = await ctx.commandDb.auction.findMany({
            where: {
                type: 'UNIQUE_ITEM',
                status: { in: ['OPEN', 'FINALIZING'] },
                targetCode: { not: null },
            },
            select: { targetCode: true },
        });
        addOccupiedUniqueItemKeys(
            occupiedUniqueCounts,
            reservedUniqueRows.map((row) => row.targetCode),
            itemRegistry
        );
    }
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
