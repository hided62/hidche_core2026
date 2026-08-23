import type {
    TurnDaemonCommandHandler,
    TurnDaemonCommand,
    TurnDaemonCommandExecutionContext,
    TurnDaemonCommandResult,
} from '../lifecycle/types.js';
import { GamePrisma, type DatabaseClient } from '@sammo-ts/infra';
import {
    asRecord,
    GAME_TICKS_PER_TURN,
    isCanonicalIsoTimestamp,
    JosaUtil,
    LiteHashDRBG,
    RandUtil,
} from '@sammo-ts/common';
import {
    LogCategory,
    LogFormat,
    LogScope,
    ITEM_KEYS,
    addOccupiedUniqueItemKeys,
    buildVoteUniqueSeed,
    countOccupiedUniqueItems,
    createItemModuleRegistry,
    isDefenceTrainPenaltyWaivedByScenarioEffect,
    isValidTroopNameWidth,
    loadItemModules,
    normalizeTroopName,
    resolveTroopSecretPermission,
    resolveUniqueConfig,
    rollUniqueLottery,
    type ItemModule,
    type MapDefinition,
    type ScenarioMeta,
    type TriggerValue,
    type TurnCommandProfile,
} from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';
import {
    cloneItemInventory,
    ensureItemInventory,
    equipNewItem,
    removeEquippedItem,
} from '@sammo-ts/logic/items/index.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { InMemoryReservedTurnStore } from './reservedTurnStore.js';
import type { TurnGeneral } from './types.js';
import { createImmediateGeneralActionExecutor, type ImmediateGeneralActionExecutor } from './reservedTurnHandler.js';
import { openAuction } from '../auction/opener.js';
import {
    hasScenarioStaticEventHandler,
    IMMEDIATE_TROOP_JOIN_MOVE_HANDLER,
    LEGACY_TROOP_JOIN_EVENT,
} from './scenarioStaticEvents.js';
import {
    createGeneralFromSelectionPool,
    reserveSelectionPool,
    reselectGeneralFromSelectionPool,
    SelectPoolError,
} from './selectPoolService.js';
import { createGeneralFromJoin, JoinCreateGeneralError } from './joinCreateGeneralService.js';
import { NpcPossessionError, possessNpcGeneral } from './npcPossessionService.js';
import { buildPrestartDeleteAfter, formatPrestartDeleteAfter, readPrestartDeleteAfter } from './prestartDeletion.js';
import { respondToActionableMessage } from './actionableMessageResponse.js';

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
    getImmediateGeneralActionExecutor?: () => Promise<ImmediateGeneralActionExecutor>;
    reservedTurns?: InMemoryReservedTurnStore;
    loadArchivedNationMaxId?: (serverId: string) => Promise<number>;
}

const requireCommandDatabase = (ctx: CommandHandlerContext): DatabaseClient => {
    if (!ctx.commandDb) {
        throw new Error('ENGINE mutation transaction is required for authenticated commands.');
    }
    return ctx.commandDb as unknown as DatabaseClient;
};

const resolveCommandAcceptedAt = async (
    db: DatabaseClient,
    command: Extract<
        TurnDaemonCommand,
        {
            type:
                | 'dieOnPrestart'
                | 'ensureDieOnPrestartStatus'
                | 'joinCreateGeneral'
                | 'npcPossessGeneral'
                | 'selectPoolReserve'
                | 'selectPoolCreate'
                | 'selectPoolReselect'
                | 'adjustGeneralIcon';
        }
    >
): Promise<Date> => {
    if (!command.requestId) {
        throw new Error(`${command.type} requestId is required.`);
    }
    const event = await db.inputEvent.findUnique({
        where: { requestId: command.requestId },
        select: { createdAt: true, actorUserId: true, target: true, eventType: true },
    });
    if (!event) {
        throw new Error(`ENGINE input event ${command.requestId} is missing.`);
    }
    if (event.actorUserId !== command.userId) {
        throw new Error(`ENGINE input event actor does not match ${command.type} user.`);
    }
    if (event.target !== 'ENGINE' || event.eventType !== command.type) {
        throw new Error(`ENGINE input event type does not match ${command.type}.`);
    }
    return event.createdAt;
};

const resolveSelectionCommandAcceptedAt = async (
    db: DatabaseClient,
    world: InMemoryTurnWorld,
    command: Extract<TurnDaemonCommand, { type: 'selectPoolReserve' | 'selectPoolCreate' | 'selectPoolReselect' }>
): Promise<Date> => {
    const operationalAcceptedAt = await resolveCommandAcceptedAt(db, command);
    if (command.acceptedGameTick !== undefined) {
        return world.gameTickToDate(command.acceptedGameTick);
    }
    if (command.acceptedGameAt !== undefined) {
        return new Date(command.acceptedGameAt);
    }
    return world.getGameNow(operationalAcceptedAt);
};

const resolveOperationalAcceptedAt = async (
    db: DatabaseClient,
    command: Pick<TurnDaemonCommand, 'type' | 'requestId'>
): Promise<Date> => {
    if (!command.requestId) {
        return new Date();
    }
    const event = await db.inputEvent.findUnique({
        where: { requestId: command.requestId },
        select: { createdAt: true, target: true, eventType: true },
    });
    if (!event) {
        throw new Error(`ENGINE input event ${command.requestId} is missing.`);
    }
    if (event.target !== 'ENGINE' || event.eventType !== command.type) {
        throw new Error(`ENGINE input event type does not match ${command.type}.`);
    }
    return event.createdAt;
};

const assertImmediateGeneralActionActor = async (
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'buildNationCandidate' | 'instantRetreat' }>,
    general: TurnGeneral
): Promise<void> => {
    if (general.userId !== command.userId) {
        throw new Error(`${command.type} general owner does not match command user.`);
    }
    if (!command.requestId) {
        return;
    }
    const db = requireCommandDatabase(ctx);
    const event = await db.inputEvent.findUnique({
        where: { requestId: command.requestId },
        select: { actorUserId: true },
    });
    if (!event) {
        throw new Error(`ENGINE input event ${command.requestId} is missing.`);
    }
    if (event.actorUserId !== command.userId) {
        throw new Error(`ENGINE input event actor does not match ${command.type} user.`);
    }
};

async function handleJoinCreateGeneral(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'joinCreateGeneral' }>
): Promise<TurnDaemonCommandResult> {
    const db = requireCommandDatabase(ctx);
    const worldState = await db.worldState.findUnique({
        where: { id: ctx.world.getState().id },
    });
    if (!worldState) {
        throw new Error('Join world state is missing.');
    }
    const operationalAcceptedAt = await resolveCommandAcceptedAt(db, command);
    const acceptedAt = ctx.world.getGameNow(operationalAcceptedAt);
    try {
        return {
            type: 'joinCreateGeneral',
            ...(await createGeneralFromJoin({
                db,
                world: ctx.world,
                worldState,
                input: {
                    userId: command.userId,
                    ownerDisplayName: command.ownerDisplayName,
                    seedOwnerIdentity: command.seedOwnerIdentity,
                    name: command.name,
                    leadership: command.leadership,
                    strength: command.strength,
                    intel: command.intel,
                    pic: command.pic,
                    character: command.character,
                    profileId: command.profileId,
                    ...(command.ownerPicture !== undefined ? { ownerPicture: command.ownerPicture } : {}),
                    ...(command.ownerImageServer !== undefined ? { ownerImageServer: command.ownerImageServer } : {}),
                    ...(command.ownerIconRevision !== undefined
                        ? { ownerIconRevision: command.ownerIconRevision }
                        : {}),
                    ...(command.ownerCanUsePicture !== undefined
                        ? { ownerCanUsePicture: command.ownerCanUsePicture }
                        : {}),
                    ...(command.ownerLegacyPenalty !== undefined
                        ? { ownerLegacyPenalty: command.ownerLegacyPenalty }
                        : {}),
                    ...(command.inheritSpecial !== undefined ? { inheritSpecial: command.inheritSpecial } : {}),
                    ...(command.inheritTurntimeZone !== undefined
                        ? { inheritTurntimeZone: command.inheritTurntimeZone }
                        : {}),
                    ...(command.inheritCity !== undefined ? { inheritCity: command.inheritCity } : {}),
                    ...(command.inheritBonusStat !== undefined ? { inheritBonusStat: command.inheritBonusStat } : {}),
                },
                acceptedAt,
            })),
        };
    } catch (error) {
        if (error instanceof JoinCreateGeneralError) {
            return {
                type: 'joinCreateGeneral',
                ok: false,
                code: error.code,
                reason: error.message,
            };
        }
        throw error;
    }
}

async function handleNpcPossessGeneral(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'npcPossessGeneral' }>
): Promise<TurnDaemonCommandResult> {
    const db = requireCommandDatabase(ctx);
    const worldState = await db.worldState.findUnique({
        where: { id: ctx.world.getState().id },
    });
    if (!worldState) {
        throw new Error('NPC possession world state is missing.');
    }
    const operationalAcceptedAt = await resolveCommandAcceptedAt(db, command);
    const acceptedAt = command.acceptedGameAt
        ? new Date(command.acceptedGameAt)
        : ctx.world.getGameNow(operationalAcceptedAt);
    try {
        return {
            type: 'npcPossessGeneral',
            ...(await possessNpcGeneral({
                db,
                world: ctx.world,
                worldState,
                userId: command.userId,
                ownerDisplayName: command.ownerDisplayName,
                profileId: command.profileId,
                ...(command.ownerLegacyPenalty !== undefined ? { ownerLegacyPenalty: command.ownerLegacyPenalty } : {}),
                generalId: command.generalId,
                tokenNonce: command.tokenNonce,
                acceptedAt,
            })),
        };
    } catch (error) {
        if (error instanceof NpcPossessionError) {
            return {
                type: 'npcPossessGeneral',
                ok: false,
                code: error.code,
                reason: error.message,
            };
        }
        throw error;
    }
}

async function handleSelectPoolCreate(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'selectPoolCreate' }>
): Promise<TurnDaemonCommandResult> {
    const db = requireCommandDatabase(ctx);
    const worldState = await db.worldState.findUnique({
        where: { id: ctx.world.getState().id },
    });
    if (!worldState) {
        throw new Error('Selection-pool world state is missing.');
    }
    const acceptedAt = await resolveSelectionCommandAcceptedAt(db, ctx.world, command);
    try {
        return {
            type: 'selectPoolCreate',
            ...(await createGeneralFromSelectionPool({
                db,
                world: ctx.world,
                worldState,
                userId: command.userId,
                ownerDisplayName: command.ownerDisplayName,
                uniqueName: command.uniqueName,
                personality: command.personality,
                seedOwnerIdentity: command.seedOwnerIdentity,
                ...(command.ownerPicture ? { ownerPicture: command.ownerPicture } : {}),
                ...(command.ownerImageServer !== undefined ? { ownerImageServer: command.ownerImageServer } : {}),
                ...(command.ownerIconRevision ? { ownerIconRevision: command.ownerIconRevision } : {}),
                now: acceptedAt,
            })),
        };
    } catch (error) {
        if (error instanceof SelectPoolError) {
            return {
                type: 'selectPoolCreate',
                ok: false,
                code: error.code,
                reason: error.message,
            };
        }
        throw error;
    }
}

async function handleSelectPoolReserve(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'selectPoolReserve' }>
): Promise<TurnDaemonCommandResult> {
    const db = requireCommandDatabase(ctx);
    const worldState = await db.worldState.findUnique({
        where: { id: ctx.world.getState().id },
    });
    if (!worldState) {
        throw new Error('Selection-pool world state is missing.');
    }
    const acceptedAt = await resolveSelectionCommandAcceptedAt(db, ctx.world, command);
    try {
        return {
            type: 'selectPoolReserve',
            ok: true,
            reservation: await reserveSelectionPool({
                db,
                world: ctx.world,
                worldState,
                userId: command.userId,
                seedOwnerIdentity: command.seedOwnerIdentity,
                now: acceptedAt,
                ...(command.acceptedGameTick === undefined ? {} : { acceptedGameTick: command.acceptedGameTick }),
            }),
        };
    } catch (error) {
        if (error instanceof SelectPoolError) {
            return {
                type: 'selectPoolReserve',
                ok: false,
                code: error.code,
                reason: error.message,
            };
        }
        throw error;
    }
}

async function handleSelectPoolReselect(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'selectPoolReselect' }>
): Promise<TurnDaemonCommandResult> {
    const db = requireCommandDatabase(ctx);
    const worldState = await db.worldState.findUnique({
        where: { id: ctx.world.getState().id },
    });
    if (!worldState) {
        throw new Error('Selection-pool world state is missing.');
    }
    const acceptedAt = await resolveSelectionCommandAcceptedAt(db, ctx.world, command);
    try {
        return {
            type: 'selectPoolReselect',
            ...(await reselectGeneralFromSelectionPool({
                db,
                world: ctx.world,
                worldState,
                userId: command.userId,
                ownerDisplayName: command.ownerDisplayName,
                uniqueName: command.uniqueName,
                now: acceptedAt,
            })),
        };
    } catch (error) {
        if (error instanceof SelectPoolError) {
            return {
                type: 'selectPoolReselect',
                ok: false,
                code: error.code,
                reason: error.message,
            };
        }
        throw error;
    }
}

interface AuctionFinalizer {
    finalize(
        command: Extract<TurnDaemonCommand, { type: 'auctionFinalize' }>,
        db?: GamePrisma.TransactionClient
    ): Promise<TurnDaemonCommandResult>;
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

    let attackerGDelta: number;
    let defenderGDelta: number;
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
    if (command.patch.specialWar !== undefined) {
        patch.role = {
            ...general.role,
            specialWar: command.patch.specialWar === 'None' ? null : command.patch.specialWar,
        };
    }

    world.updateGeneral(command.generalId, patch);
    return { type: 'patchGeneral', ok: true, generalId: command.generalId };
}

async function handleAdjustGeneralIcon(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'adjustGeneralIcon' }>
): Promise<TurnDaemonCommandResult> {
    const db = requireCommandDatabase(ctx);
    const acceptedAt = await resolveCommandAcceptedAt(db, command);
    const general = ctx.world
        .listGenerals()
        .find((candidate) => candidate.userId === command.userId && candidate.npcState === 0);
    if (!general) {
        return {
            type: 'adjustGeneralIcon',
            ok: true,
            generalId: null,
            updated: false,
        };
    }

    if (command.enforceCooldown) {
        if (general.picture === command.picture && general.imageServer === command.imageServer) {
            return {
                type: 'adjustGeneralIcon',
                ok: true,
                generalId: general.id,
                updated: false,
            };
        }
        const changedAt = general.meta.generalIconChangedAt;
        if (typeof changedAt === 'string' && isCanonicalIsoTimestamp(changedAt)) {
            const availableAt = new Date(new Date(changedAt).getTime() + 24 * 60 * 60 * 1000);
            if (availableAt.getTime() > acceptedAt.getTime()) {
                return {
                    type: 'adjustGeneralIcon',
                    ok: false,
                    code: 'TOO_MANY_REQUESTS',
                    reason: `${availableAt.toISOString()}부터 전용 아이콘을 다시 바꿀 수 있습니다.`,
                    availableAt: availableAt.toISOString(),
                };
            }
        }
        ctx.world.updateGeneral(general.id, {
            picture: command.picture,
            imageServer: command.imageServer,
            meta: {
                ...general.meta,
                generalIconChangedAt: acceptedAt.toISOString(),
            },
        });
        return {
            type: 'adjustGeneralIcon',
            ok: true,
            generalId: general.id,
            updated: true,
        };
    }

    const currentRevision = general.meta.accountIconUpdatedAt;
    if (currentRevision !== undefined) {
        if (typeof currentRevision !== 'string' || !isCanonicalIsoTimestamp(currentRevision)) {
            return {
                type: 'adjustGeneralIcon',
                ok: false,
                code: 'PRECONDITION_FAILED',
                reason: '장수의 계정 아이콘 revision이 올바르지 않습니다.',
            };
        }
        const currentRevisionTime = new Date(currentRevision).getTime();
        const nextRevisionTime = new Date(command.iconRevision).getTime();
        if (nextRevisionTime < currentRevisionTime) {
            return {
                type: 'adjustGeneralIcon',
                ok: false,
                code: 'CONFLICT',
                reason: '더 최신 계정 아이콘이 이미 적용되었습니다.',
            };
        }
        if (nextRevisionTime === currentRevisionTime) {
            if (general.picture === command.picture && general.imageServer === command.imageServer) {
                return {
                    type: 'adjustGeneralIcon',
                    ok: true,
                    generalId: general.id,
                    updated: false,
                };
            }
            return {
                type: 'adjustGeneralIcon',
                ok: false,
                code: 'CONFLICT',
                reason: '같은 revision에 다른 계정 아이콘이 요청되었습니다.',
            };
        }
    }

    ctx.world.updateGeneral(general.id, {
        picture: command.picture,
        imageServer: command.imageServer,
        meta: {
            ...general.meta,
            accountIconUpdatedAt: command.iconRevision,
        },
    });
    return {
        type: 'adjustGeneralIcon',
        ok: true,
        generalId: general.id,
        updated: true,
    };
}

async function handleShiftSchedule(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'shiftSchedule' }>
): Promise<TurnDaemonCommandResult> {
    if (!ctx.commandDb) {
        return {
            type: 'shiftSchedule',
            ok: false,
            actionId: command.actionId,
            reason: '시간 조정은 데이터베이스 transaction 경계에서만 실행할 수 있습니다.',
        };
    }

    const operationalAcceptedAt = await resolveOperationalAcceptedAt(ctx.commandDb, command);
    const shifted = ctx.world.shiftSchedule(command.deltaMinutes, operationalAcceptedAt);
    const shiftedAuctions = await ctx.commandDb.$executeRaw(
        GamePrisma.sql`
            UPDATE auction
            SET close_at = close_at + (${command.deltaMinutes} * INTERVAL '1 minute'),
                updated_at = NOW()
            WHERE status = 'OPEN'
        `
    );
    await ctx.commandDb.$executeRaw(
        GamePrisma.sql`
            UPDATE select_pool
            SET reserved_until = reserved_until + (${command.deltaMinutes} * INTERVAL '1 minute')
            WHERE reserved_until IS NOT NULL
        `
    );
    await ctx.commandDb.$executeRaw(
        GamePrisma.sql`
            UPDATE select_npc_token
            SET valid_until = valid_until + (${command.deltaMinutes} * INTERVAL '1 minute'),
                pick_more_from = pick_more_from + (${command.deltaMinutes} * INTERVAL '1 minute')
        `
    );
    await ctx.commandDb.$executeRaw(
        GamePrisma.sql`
            UPDATE message
            SET time = CASE WHEN time_tick IS NULL THEN time ELSE time + (${command.deltaMinutes} * INTERVAL '1 minute') END,
                valid_until = CASE
                    WHEN valid_until_tick IS NULL THEN valid_until
                    ELSE valid_until + (${command.deltaMinutes} * INTERVAL '1 minute')
                END
            WHERE time_tick IS NOT NULL OR valid_until_tick IS NOT NULL
        `
    );
    await ctx.commandDb.$executeRaw(
        GamePrisma.sql`
            UPDATE vote_poll
            SET start_at = CASE WHEN start_tick IS NULL THEN start_at ELSE start_at + (${command.deltaMinutes} * INTERVAL '1 minute') END,
                end_at = CASE
                    WHEN end_tick IS NULL THEN end_at
                    ELSE end_at + (${command.deltaMinutes} * INTERVAL '1 minute')
                END,
                closed_at = CASE
                    WHEN closed_at IS NULL THEN NULL
                    ELSE closed_at + (${command.deltaMinutes} * INTERVAL '1 minute')
                END
            WHERE start_tick IS NOT NULL OR end_tick IS NOT NULL OR closed_at IS NOT NULL
        `
    );

    return {
        type: 'shiftSchedule',
        ok: true,
        actionId: command.actionId,
        deltaMinutes: command.deltaMinutes,
        lastTurnTime: shifted.lastTurnTime,
        shiftedGenerals: shifted.shiftedGenerals,
        shiftedAuctions,
        checkpoint: ctx.world.getCheckpoint(),
    };
}

async function handleUpdateRuntimeSettings(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'updateRuntimeSettings' }>
): Promise<TurnDaemonCommandResult> {
    if (!ctx.commandDb) {
        return {
            type: 'updateRuntimeSettings',
            ok: false,
            actionId: command.actionId,
            reason: '런타임 설정 변경은 데이터베이스 transaction 경계에서만 실행할 수 있습니다.',
        };
    }

    const operationalAcceptedAt = await resolveOperationalAcceptedAt(ctx.commandDb, command);
    if (command.settings.blockGeneralCreate !== undefined) {
        ctx.world.updateWorldConfig({ blockGeneralCreate: command.settings.blockGeneralCreate });
    }
    if (command.settings.autorunUser !== undefined) {
        ctx.world.updateWorldMeta({
            autorun_user:
                command.settings.autorunUser === null
                    ? null
                    : {
                          limit_minutes: command.settings.autorunUser.limitMinutes,
                          options: Object.fromEntries(
                              command.settings.autorunUser.options.map((option) => [option, true])
                          ),
                      },
        });
    }

    const currentState = ctx.world.getState();
    const currentTermMinutes = Math.max(1, Math.round(currentState.tickSeconds / 60));
    const term =
        command.settings.turnTermMinutes === undefined
            ? {
                  changed: false,
                  previousTurnTermMinutes: currentTermMinutes,
                  turnTermMinutes: currentTermMinutes,
                  previousClockBaseTime: (currentState.clockBaseTime ?? currentState.lastTurnTime).toISOString(),
                  clockBaseTime: (currentState.clockBaseTime ?? currentState.lastTurnTime).toISOString(),
                  shiftedGenerals: 0,
                  lastTurnTime: currentState.lastTurnTime.toISOString(),
              }
            : ctx.world.changeTurnTerm(command.settings.turnTermMinutes, operationalAcceptedAt);

    let reprojectedAuctions = 0;
    let reprojectedMessages = 0;
    let reprojectedVotes = 0;
    if (term.changed) {
        const ticksPerSecond = BigInt(GAME_TICKS_PER_TURN / (term.turnTermMinutes * 60));
        const baseTime = new Date(term.clockBaseTime);
        reprojectedAuctions = await ctx.commandDb.$executeRaw(
            GamePrisma.sql`
                UPDATE auction
                SET close_at = CAST(${baseTime} AS timestamp)
                    + (close_tick / ${ticksPerSecond}) * INTERVAL '1 second'
                    + (((close_tick % ${ticksPerSecond}) * 1000) / ${ticksPerSecond}) * INTERVAL '1 millisecond',
                    updated_at = NOW()
                WHERE close_tick IS NOT NULL
            `
        );
        reprojectedMessages = await ctx.commandDb.$executeRaw(
            GamePrisma.sql`
                UPDATE message
                SET time = CASE
                        WHEN time_tick IS NULL THEN time
                        ELSE CAST(${baseTime} AS timestamp)
                            + (time_tick / ${ticksPerSecond}) * INTERVAL '1 second'
                            + (((time_tick % ${ticksPerSecond}) * 1000) / ${ticksPerSecond}) * INTERVAL '1 millisecond'
                    END,
                    valid_until = CASE
                        WHEN valid_until_tick IS NULL THEN valid_until
                        ELSE CAST(${baseTime} AS timestamp)
                            + (valid_until_tick / ${ticksPerSecond}) * INTERVAL '1 second'
                            + (((valid_until_tick % ${ticksPerSecond}) * 1000) / ${ticksPerSecond}) * INTERVAL '1 millisecond'
                    END
                WHERE time_tick IS NOT NULL OR valid_until_tick IS NOT NULL
            `
        );
        reprojectedVotes = await ctx.commandDb.$executeRaw(
            GamePrisma.sql`
                UPDATE vote_poll
                SET start_at = CASE
                        WHEN start_tick IS NULL THEN start_at
                        ELSE CAST(${baseTime} AS timestamp)
                            + (start_tick / ${ticksPerSecond}) * INTERVAL '1 second'
                            + (((start_tick % ${ticksPerSecond}) * 1000) / ${ticksPerSecond}) * INTERVAL '1 millisecond'
                    END,
                    end_at = CASE
                        WHEN end_tick IS NULL THEN end_at
                        ELSE CAST(${baseTime} AS timestamp)
                            + (end_tick / ${ticksPerSecond}) * INTERVAL '1 second'
                            + (((end_tick % ${ticksPerSecond}) * 1000) / ${ticksPerSecond}) * INTERVAL '1 millisecond'
                    END
                WHERE start_tick IS NOT NULL OR end_tick IS NOT NULL
            `
        );
        ctx.world.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            text: `<R>★</>턴시간이 <C>${term.turnTermMinutes}분</>으로 변경됩니다.`,
        });
    }

    return {
        type: 'updateRuntimeSettings',
        ok: true,
        actionId: command.actionId,
        settings: command.settings,
        termChanged: term.changed,
        previousTurnTermMinutes: term.previousTurnTermMinutes,
        turnTermMinutes: term.turnTermMinutes,
        previousClockBaseTime: term.previousClockBaseTime,
        clockBaseTime: term.clockBaseTime,
        lastTurnTime: term.lastTurnTime,
        shiftedGenerals: term.shiftedGenerals,
        reprojectedAuctions,
        reprojectedMessages,
        reprojectedVotes,
        checkpoint: ctx.world.getCheckpoint(),
    };
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
    if (
        hasScenarioStaticEventHandler(
            world.getScenarioConfig(),
            LEGACY_TROOP_JOIN_EVENT,
            IMMEDIATE_TROOP_JOIN_MOVE_HANDLER
        )
    ) {
        const leader = world.getGeneralById(troop.id);
        if (
            leader &&
            leader.troopId === leader.id &&
            leader.nationId === general.nationId &&
            leader.cityId !== general.cityId
        ) {
            const city = world.getCityById(leader.cityId);
            if (city) {
                world.updateGeneral(command.generalId, {
                    troopId: command.troopId,
                    cityId: leader.cityId,
                });
                const josaRo = JosaUtil.pick(city.name, '로');
                world.pushLog({
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.PLAIN,
                    text: `부대 주둔지인 <G><b>${city.name}</b></>${josaRo} 즉시 이동합니다.`,
                    generalId: general.id,
                    meta: {},
                });
            }
        }
    }
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

const ensurePrestartDeleteAfter = async (
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'dieOnPrestart' | 'ensureDieOnPrestartStatus' }>,
    general: TurnGeneral,
    acceptedAt: Date
): Promise<Date> => {
    const current = readPrestartDeleteAfter(asRecord(general.meta));
    if (current) {
        return current;
    }
    const db = requireCommandDatabase(ctx);
    const access = await db.generalAccessLog.findUnique({
        where: { generalId: general.id },
        select: { lastRefresh: true },
    });
    const deleteAfter = buildPrestartDeleteAfter(
        access?.lastRefresh ?? acceptedAt,
        ctx.world.getState().tickSeconds,
        asRecord(ctx.world.getScenarioConfig())
    );
    const updated = ctx.world.updateGeneral(general.id, {
        meta: {
            ...general.meta,
            prestart_delete_after: deleteAfter.toISOString(),
        },
    });
    if (!updated) {
        throw new Error(`${command.type} general disappeared while fixing the pre-start deletion time.`);
    }
    return deleteAfter;
};

async function handleEnsureDieOnPrestartStatus(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'ensureDieOnPrestartStatus' }>
): Promise<TurnDaemonCommandResult> {
    const general = ctx.world.getGeneralById(command.generalId);
    if (!general || general.npcState !== 0 || general.userId !== command.userId) {
        return {
            type: 'ensureDieOnPrestartStatus',
            generalId: command.generalId,
            show: false,
            available: false,
        };
    }
    const db = requireCommandDatabase(ctx);
    const acceptedAt = await resolveCommandAcceptedAt(db, command);
    const worldState = ctx.world.getState();
    const opentime = typeof worldState.meta.opentime === 'string' ? worldState.meta.opentime : null;
    if ((opentime && worldState.lastTurnTime.getTime() > new Date(opentime).getTime()) || general.nationId !== 0) {
        return {
            type: 'ensureDieOnPrestartStatus',
            generalId: command.generalId,
            show: false,
            available: false,
        };
    }
    const availableAt = await ensurePrestartDeleteAfter(ctx, command, general, acceptedAt);
    return {
        type: 'ensureDieOnPrestartStatus',
        generalId: command.generalId,
        show: true,
        available: availableAt.getTime() <= acceptedAt.getTime(),
        availableAt: availableAt.toISOString(),
    };
}

async function handleDieOnPrestart(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'dieOnPrestart' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    const db = requireCommandDatabase(ctx);
    const general = world.getGeneralById(command.generalId);
    if (!general || general.npcState !== 0 || general.userId !== command.userId) {
        return {
            type: 'dieOnPrestart',
            ok: false,
            generalId: command.generalId,
            reason: '장수가 없습니다',
        };
    }
    const acceptedAt = await resolveCommandAcceptedAt(db, command);
    const worldState = world.getState();
    const opentime = worldState.meta.opentime as string | undefined;
    if (opentime && new Date(worldState.lastTurnTime) > new Date(opentime)) {
        return {
            type: 'dieOnPrestart',
            ok: false,
            generalId: command.generalId,
            reason: '게임이 시작되었습니다.',
        };
    }

    if (general.nationId !== 0) {
        return {
            type: 'dieOnPrestart',
            ok: false,
            generalId: command.generalId,
            reason: '이미 국가에 소속되어있습니다.',
        };
    }

    const deleteAfter = await ensurePrestartDeleteAfter(ctx, command, general, acceptedAt);
    if (deleteAfter.getTime() > acceptedAt.getTime()) {
        return {
            type: 'dieOnPrestart',
            ok: false,
            generalId: command.generalId,
            reason: `아직 삭제할 수 없습니다. ${formatPrestartDeleteAfter(deleteAfter)} 부터 가능합니다.`,
        };
    }

    if (general.troopId === general.id) {
        for (const member of world.listGenerals()) {
            if (member.troopId === general.id) {
                world.updateGeneral(member.id, { troopId: 0 });
            }
        }
        world.removeTroop(general.id);
    }
    const josaYi = JosaUtil.pick(general.name, '이');
    world.pushLog({
        scope: LogScope.SYSTEM,
        category: LogCategory.SUMMARY,
        format: LogFormat.MONTH,
        text: `<Y>${general.name}</>${josaYi} 홀연히 모습을 <R>감추었습니다</>`,
        meta: {},
    });
    world.deleteGeneralWithLifecycle(command.generalId, worldState.currentYear, worldState.currentMonth);
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
            reason: '장수가 없습니다',
        };
    }
    await assertImmediateGeneralActionActor(ctx, command, general);

    const worldState = world.getState();
    const opentime = worldState.meta.opentime as string | undefined;
    if (opentime && new Date(worldState.lastTurnTime) > new Date(opentime)) {
        return {
            type: 'buildNationCandidate',
            ok: false,
            generalId: command.generalId,
            reason: '게임이 시작되었습니다.',
        };
    }
    if (general.nationId !== 0) {
        return {
            type: 'buildNationCandidate',
            ok: false,
            generalId: command.generalId,
            reason: '이미 국가에 소속되어있습니다.',
        };
    }

    if (!ctx.getImmediateGeneralActionExecutor) {
        throw new Error('Immediate general action runtime is not configured.');
    }
    const hiddenSeed = asRecord(worldState.meta).hiddenSeed ?? asRecord(worldState.meta).seed ?? worldState.id;
    const executor = await ctx.getImmediateGeneralActionExecutor();
    const execution = await executor.execute({
        actionKey: 'che_거병',
        generalId: command.generalId,
        rng: new RandUtil(
            new LiteHashDRBG(
                simpleSerialize(
                    typeof hiddenSeed === 'string' || typeof hiddenSeed === 'number' ? hiddenSeed : String(hiddenSeed),
                    'BuildNationCandidate',
                    command.generalId
                )
            )
        ),
        refreshKillturn: true,
    });
    return {
        type: 'buildNationCandidate',
        ok: execution.ok,
        generalId: command.generalId,
        ...(execution.reason ? { reason: execution.reason } : {}),
    };
}

async function handleInstantRetreat(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'instantRetreat' }>
): Promise<TurnDaemonCommandResult> {
    const { world } = ctx;
    const config = world.getScenarioConfig();
    const availableInstantAction = config.const.availableInstantAction as Record<string, boolean> | undefined;
    if (!availableInstantAction?.instantRetreat) {
        return {
            type: 'instantRetreat',
            ok: false,
            generalId: command.generalId,
            reason: '접경귀환을 사용할 수 없는 시나리오입니다.',
        };
    }
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return {
            type: 'instantRetreat',
            ok: false,
            generalId: command.generalId,
            reason: '장수가 없습니다',
        };
    }
    await assertImmediateGeneralActionActor(ctx, command, general);

    if (!ctx.getImmediateGeneralActionExecutor) {
        throw new Error('Immediate general action runtime is not configured.');
    }
    const state = world.getState();
    const hiddenSeed = asRecord(state.meta).hiddenSeed ?? asRecord(state.meta).seed ?? state.id;
    const executor = await ctx.getImmediateGeneralActionExecutor();
    const execution = await executor.execute({
        actionKey: 'che_접경귀환',
        generalId: command.generalId,
        rng: new RandUtil(
            new LiteHashDRBG(
                simpleSerialize(
                    typeof hiddenSeed === 'string' || typeof hiddenSeed === 'number' ? hiddenSeed : String(hiddenSeed),
                    'InstantRetreat',
                    command.generalId,
                    state.currentYear,
                    state.currentMonth,
                    general.cityId
                )
            )
        ),
    });
    return {
        type: 'instantRetreat',
        ok: execution.ok,
        generalId: command.generalId,
        ...(execution.reason ? { reason: execution.reason } : {}),
    };
}

async function handleMessageRespond(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'messageRespond' }>
): Promise<TurnDaemonCommandResult> {
    if (!ctx.getImmediateGeneralActionExecutor) {
        throw new Error('Immediate general action runtime is not configured.');
    }
    const result = await respondToActionableMessage({
        db: requireCommandDatabase(ctx) as GamePrisma.TransactionClient,
        world: ctx.world,
        reservedTurns: ctx.reservedTurns,
        executor: await ctx.getImmediateGeneralActionExecutor(),
        requestId: command.requestId,
        userId: command.userId,
        generalId: command.generalId,
        messageId: command.messageId,
        response: command.response,
        loadArchivedNationMaxId: ctx.loadArchivedNationMaxId,
    });
    return {
        type: 'messageRespond',
        ok: result.ok,
        generalId: command.generalId,
        messageId: command.messageId,
        ...(result.action ? { action: result.action } : {}),
        reason: result.reason,
    };
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
    const autorunUser = asRecord(world.getState().meta.autorun_user);
    if (autorunUser.limit_minutes) {
        return {
            type: 'vacation',
            ok: false,
            generalId: command.generalId,
            reason: '자동 턴인 경우에는 휴가 명령이 불가능합니다.',
        };
    }
    const killturn = readMetaNumber(asRecord(world.getState().meta), 'killturn', 0);
    world.updateGeneral(general.id, {
        meta: {
            ...general.meta,
            killturn: killturn * 3,
        },
    });
    return { type: 'vacation', ok: true, generalId: command.generalId };
}

const normalizeDefenceTrain = (value: number): number => {
    if (value <= 40) {
        return 40;
    }
    if (value <= 90) {
        return Math.round(value / 10) * 10;
    }
    return 999;
};

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

    const settings = command.settings;
    const previousDefenceTrain = readMetaNumber(general.meta, 'defence_train', 80);
    const nextDefenceTrain =
        settings.defence_train === undefined ? previousDefenceTrain : normalizeDefenceTrain(settings.defence_train);
    const nextMeta = { ...general.meta };

    if (settings.tnmt !== undefined) {
        nextMeta.tnmt = settings.tnmt < 0 || settings.tnmt > 1 ? 1 : settings.tnmt;
    }
    if (settings.use_treatment !== undefined) {
        nextMeta.use_treatment = Math.max(10, Math.min(100, settings.use_treatment));
    }
    if (settings.use_auto_nation_turn !== undefined) {
        nextMeta.use_auto_nation_turn = settings.use_auto_nation_turn === 0 ? 0 : 1;
    }
    for (const key of [
        'use_auto_nation_diplomacy',
        'use_auto_nation_promotion',
        'use_auto_nation_finance',
        'use_auto_nation_capital',
    ] as const) {
        if (settings[key] !== undefined) {
            nextMeta[key] = settings[key] === 1 ? 1 : 0;
        }
    }

    let nextTrain = general.train;
    let nextAtmos = general.atmos;
    if (nextDefenceTrain !== previousDefenceTrain) {
        nextMeta.myset = readMetaNumber(general.meta, 'myset', 0) - 1;
        nextMeta.defence_train = nextDefenceTrain;
        if (nextDefenceTrain === 999) {
            const scenarioEffect = world.getScenarioConfig().environment.scenarioEffect;
            const ignoresPenalty = isDefenceTrainPenaltyWaivedByScenarioEffect(scenarioEffect);
            const constValues = asRecord(world.getScenarioConfig().const);
            const maxTrain = readMetaNumber(constValues, 'maxTrainByWar', 100);
            const maxAtmos = readMetaNumber(constValues, 'maxAtmosByWar', 100);
            const trainDelta = ignoresPenalty ? 0 : -3;
            const atmosDelta = ignoresPenalty ? 0 : -6;
            nextTrain = Math.max(20, Math.min(maxTrain, general.train + trainDelta));
            nextAtmos = Math.max(20, Math.min(maxAtmos, general.atmos + atmosDelta));
        }
    }

    world.updateGeneral(command.generalId, {
        meta: nextMeta,
        train: nextTrain,
        atmos: nextAtmos,
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
    const slot = (['horse', 'weapon', 'book', 'item'] as const).find((candidate) => candidate === command.itemType);
    if (!slot || !general.role.items[slot]) {
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
    return ctx.auctionFinalizer.finalize(command, ctx.commandDb);
}

async function handleAuctionOpen(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'auctionOpen' }>
): Promise<TurnDaemonCommandResult> {
    const worldMeta = asRecord(ctx.world.getState().meta);
    if (Number(worldMeta.isUnited ?? 0) !== 0 || Number(worldMeta.isunited ?? 0) !== 0) {
        return { type: 'auctionOpen', ok: false, reason: '천하통일 후에는 경매를 이용할 수 없습니다.' };
    }
    return openAuction(command, ctx.world, ctx.commandDb);
}

async function handleAuctionBid(
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'auctionBid' }>
): Promise<TurnDaemonCommandResult> {
    const worldMeta = asRecord(ctx.world.getState().meta);
    if (Number(worldMeta.isUnited ?? 0) !== 0 || Number(worldMeta.isunited ?? 0) !== 0) {
        return {
            type: 'auctionBid',
            ok: false,
            auctionId: command.auctionId,
            reason: '천하통일 후에는 경매를 이용할 수 없습니다.',
        };
    }
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
                time: world.getGameNow(new Date()),
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

    const tournamentName = ['전력전', '통솔전', '일기토', '설전'][command.tournamentType ?? -1] ?? '대회';
    const payoutsByGeneral = new Map<number, number>();
    for (const payout of command.payouts) {
        if (
            !payout ||
            typeof payout.generalId !== 'number' ||
            typeof payout.amount !== 'number' ||
            payout.amount <= 0
        ) {
            continue;
        }
        payoutsByGeneral.set(payout.generalId, (payoutsByGeneral.get(payout.generalId) ?? 0) + payout.amount);
    }

    let processed = 0;
    let missing = 0;
    let totalPayout = 0;
    for (const [generalId, amount] of payoutsByGeneral) {
        const general = world.getGeneralById(generalId);
        if (!general) {
            missing += 1;
            continue;
        }
        const shouldRecordRank =
            general.npcState === 0 ||
            (general.npcState === 1 &&
                typeof general.meta.betgold === 'number' &&
                Number.isFinite(general.meta.betgold) &&
                general.meta.betgold > 0);
        const nextMeta = { ...general.meta } as TurnGeneral['meta'];
        if (shouldRecordRank) {
            const currentBetwin = typeof nextMeta.betwin === 'number' ? Number(nextMeta.betwin) : 0;
            const currentBetwingold = typeof nextMeta.betwingold === 'number' ? Number(nextMeta.betwingold) : 0;
            nextMeta.betwin = currentBetwin + 1;
            nextMeta.betwingold = currentBetwingold + amount;
        }
        world.updateGeneral(generalId, {
            gold: general.gold + amount,
            ...(shouldRecordRank ? { meta: nextMeta } : {}),
        });
        processed += 1;
        totalPayout += amount;
        world.pushLog({
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            format: LogFormat.EVENT_PLAIN,
            generalId,
            text: `<C>${tournamentName}</>의 베팅 당첨 보상으로 <C>${amount.toLocaleString('ko-KR')}</>의 <S>금</> 획득!`,
            meta: {},
        });
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

type VoteSelectionPersistenceResult = 'inserted' | 'existing-match' | 'existing-mismatch' | 'missing';

const normalizePersistedVoteSelection = (value: unknown): number[] | null => {
    let parsed = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value) as unknown;
        } catch {
            return null;
        }
    }
    if (!Array.isArray(parsed)) return null;
    if (parsed.some((entry) => typeof entry !== 'number' || !Number.isInteger(entry))) return null;
    const normalized = [...parsed].sort((left, right) => left - right);
    return new Set(normalized).size === normalized.length ? normalized : null;
};

const voteSelectionsMatch = (stored: unknown, submitted: number[]): boolean => {
    const normalized = normalizePersistedVoteSelection(stored);
    return (
        normalized !== null &&
        normalized.length === submitted.length &&
        normalized.every((value, index) => value === submitted[index])
    );
};

const readExistingVoteSelection = async (
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'voteReward' }>,
    selection: number[]
): Promise<Exclude<VoteSelectionPersistenceResult, 'inserted'>> => {
    if (!ctx.commandDb) return 'missing';
    const rows = await ctx.commandDb.$queryRaw<Array<{ selection: unknown }>>(GamePrisma.sql`
        SELECT selection
        FROM vote
        WHERE vote_id = ${command.voteId}
          AND general_id = ${command.generalId}
        FOR UPDATE
    `);
    if (!rows[0]) return 'missing';
    return voteSelectionsMatch(rows[0].selection, selection) ? 'existing-match' : 'existing-mismatch';
};

const insertVoteSelection = async (
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'voteReward' }>,
    general: TurnGeneral,
    selection: number[]
): Promise<VoteSelectionPersistenceResult> => {
    if (!ctx.commandDb) {
        return 'missing';
    }
    const rows = await ctx.commandDb.$queryRaw<Array<{ id: number }>>(GamePrisma.sql`
        INSERT INTO vote (vote_id, general_id, nation_id, selection)
        SELECT poll.id,
            ${general.id},
            ${general.nationId},
            CAST(${JSON.stringify(selection)} AS jsonb)
        FROM vote_poll poll
        WHERE poll.id = ${command.voteId}
        ON CONFLICT (vote_id, general_id) DO NOTHING
        RETURNING id
    `);
    if (rows[0]?.id) return 'inserted';
    return readExistingVoteSelection(ctx, command, selection);
};

type VotePollValidationRow = {
    options: unknown;
    multipleOptions: number;
    endAt: Date | null;
    endTick: bigint | number | string | null;
    closedAt: Date | null;
};

export const hasVotePollDeadlinePassed = (
    poll: Pick<VotePollValidationRow, 'endAt' | 'endTick' | 'closedAt'>,
    acceptedGameAt: Date,
    acceptedGameTick: number
): boolean => {
    const endTick =
        poll.endTick === null ? null : typeof poll.endTick === 'bigint' ? poll.endTick : BigInt(poll.endTick);
    return (
        poll.closedAt !== null ||
        (endTick !== null
            ? endTick < BigInt(acceptedGameTick)
            : Boolean(poll.endAt && poll.endAt.getTime() < acceptedGameAt.getTime()))
    );
};

const parseVoteOptionCount = (value: unknown): number => {
    if (Array.isArray(value)) {
        return value.filter((entry) => typeof entry === 'string').length;
    }
    if (typeof value !== 'string') return 0;
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string').length : 0;
    } catch {
        return 0;
    }
};

const validateVoteSelectionInTransaction = async (
    ctx: CommandHandlerContext,
    command: Extract<TurnDaemonCommand, { type: 'voteReward' }>,
    selection: number[]
): Promise<string | null> => {
    if (!ctx.commandDb) return '설문 응답 트랜잭션이 준비되지 않았습니다.';
    const rows = await ctx.commandDb.$queryRaw<VotePollValidationRow[]>(GamePrisma.sql`
        SELECT options,
               multiple_options AS "multipleOptions",
               end_at AS "endAt",
               end_tick AS "endTick",
               closed_at AS "closedAt"
        FROM vote_poll
        WHERE id = ${command.voteId}
        FOR UPDATE
    `);
    const poll = rows[0];
    if (!poll) return '설문조사가 없습니다.';

    const processingNow = ctx.world.getGameNow(new Date());
    const acceptedGameTick = command.acceptedGameTick ?? ctx.world.dateToGameTick(processingNow);
    const acceptedGameAt =
        command.acceptedGameTick === undefined ? processingNow : ctx.world.gameTickToDate(command.acceptedGameTick);
    if (hasVotePollDeadlinePassed(poll, acceptedGameAt, acceptedGameTick)) {
        return '설문조사가 종료되었습니다.';
    }

    const optionCount = parseVoteOptionCount(poll.options);
    if (selection.some((value) => value < 0 || value >= optionCount)) {
        return '선택한 항목이 없습니다.';
    }
    if (poll.multipleOptions >= 1 && selection.length > poll.multipleOptions) {
        return '선택한 항목이 너무 많습니다.';
    }
    return null;
};

// 설문 응답과 보상은 같은 ENGINE mutation transaction에서 확정한다.
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
    const hasExistingReward = Object.prototype.hasOwnProperty.call(existingRewards, rewardKey);
    const buildAlreadyAppliedResult = (): TurnDaemonCommandResult => {
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
    };

    const sortedSelection = [...command.selection].sort((a, b) => a - b);
    if (
        sortedSelection.length === 0 ||
        sortedSelection.some((value) => !Number.isInteger(value)) ||
        new Set(sortedSelection).size !== sortedSelection.length
    ) {
        return {
            type: 'voteReward',
            ok: false,
            voteId: command.voteId,
            generalId: command.generalId,
            reason: '선택한 항목이 올바르지 않습니다.',
        };
    }
    if (!ctx.commandDb) {
        return {
            type: 'voteReward',
            ok: false,
            voteId: command.voteId,
            generalId: command.generalId,
            reason: '설문 응답 트랜잭션이 준비되지 않았습니다.',
        };
    }
    if (hasExistingReward) {
        // The reward marker is the idempotency authority. Do not invent a vote
        // row from a later retry when the original selection is unavailable.
        return buildAlreadyAppliedResult();
    }

    const selectionError = await validateVoteSelectionInTransaction(ctx, command, sortedSelection);
    let votePersistence: VoteSelectionPersistenceResult | null = null;
    if (selectionError === '설문조사가 종료되었습니다.') {
        // Before vote+reward became one ENGINE transaction, the API could
        // persist the vote and fail before the reward command committed. A
        // matching locked row is sufficient evidence to repair that partial
        // even when the poll has since closed.
        votePersistence = await readExistingVoteSelection(ctx, command, sortedSelection);
        if (votePersistence === 'existing-mismatch') {
            return {
                type: 'voteReward',
                ok: false,
                voteId: command.voteId,
                generalId: command.generalId,
                reason: '이미 설문조사를 완료하였습니다.',
            };
        }
        if (votePersistence !== 'existing-match') {
            return {
                type: 'voteReward',
                ok: false,
                voteId: command.voteId,
                generalId: command.generalId,
                reason: selectionError,
            };
        }
    } else if (selectionError) {
        return {
            type: 'voteReward',
            ok: false,
            voteId: command.voteId,
            generalId: command.generalId,
            reason: selectionError,
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
    const configConst = asRecord(world.getScenarioConfig().const);
    const configuredDevelCost = readMetaNumber(
        configConst,
        'develCost',
        readMetaNumber(configConst, 'develcost', readMetaNumber(configConst, 'develrate', 0))
    );
    const voteReward =
        readMetaNumber(
            worldMeta,
            'develcost',
            readMetaNumber(worldMeta, 'develCost', readMetaNumber(worldMeta, 'develrate', configuredDevelCost))
        ) * 5;

    const itemRegistry = await getItemRegistry();
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

    const awardedItemModule = itemKey ? itemRegistry.get(itemKey) : null;
    if (itemKey && !awardedItemModule) {
        return {
            type: 'voteReward',
            ok: false,
            voteId: command.voteId,
            generalId: command.generalId,
            reason: '유니크 아이템을 찾을 수 없습니다.',
        };
    }

    if (votePersistence === null) {
        votePersistence = await insertVoteSelection(ctx, command, general, sortedSelection);
    }
    if (votePersistence !== 'inserted' && votePersistence !== 'existing-match') {
        return {
            type: 'voteReward',
            ok: false,
            voteId: command.voteId,
            generalId: command.generalId,
            reason: '이미 설문조사를 완료하였습니다.',
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
        gold: general.gold + voteReward,
        meta: nextMeta,
    };

    if (itemKey && awardedItemModule) {
        const nextGeneral = {
            ...general,
            role: { ...general.role, items: { ...general.role.items } },
            itemInventory: cloneItemInventory(ensureItemInventory(general)),
        };
        equipNewItem(nextGeneral, awardedItemModule.slot, itemKey, {
            ...(awardedItemModule.initialCharges === undefined ? {} : { charges: awardedItemModule.initialCharges }),
        });
        patch.role = nextGeneral.role;
        patch.itemInventory = nextGeneral.itemInventory;

        const nationName = world.getNationById(general.nationId)?.name ?? '재야';
        const generalName = general.name;
        const itemName = awardedItemModule.name;
        const itemRawName = awardedItemModule.rawName;
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
    reservedTurns?: InMemoryReservedTurnStore;
    scenarioMeta?: ScenarioMeta;
    map?: MapDefinition;
    commandProfile?: TurnCommandProfile;
    getAdditionalOccupiedUniqueItemKeys?: () => Iterable<string | null | undefined>;
    auctionFinalizer?: AuctionFinalizer;
    auctionBidder?: AuctionBidder;
    tournamentRewardFinalizer?: TournamentRewardFinalizer;
    loadArchivedNationMaxId?: (serverId: string) => Promise<number>;
}): TurnDaemonCommandHandler => {
    let immediateGeneralActionExecutor: Promise<ImmediateGeneralActionExecutor> | null = null;
    const ctx: CommandHandlerContext = {
        world: options.world,
        auctionFinalizer: options.auctionFinalizer,
        auctionBidder: options.auctionBidder,
        tournamentRewardFinalizer: options.tournamentRewardFinalizer,
        reservedTurns: options.reservedTurns,
        loadArchivedNationMaxId: options.loadArchivedNationMaxId,
        getImmediateGeneralActionExecutor: () => {
            immediateGeneralActionExecutor ??= createImmediateGeneralActionExecutor({
                world: options.world,
                reservedTurns: options.reservedTurns,
                scenarioMeta: options.scenarioMeta,
                map: options.map,
                commandProfile: options.commandProfile,
                getAdditionalOccupiedUniqueItemKeys: async () => {
                    if (ctx.commandDb) {
                        const rows = await ctx.commandDb.auction.findMany({
                            where: {
                                type: 'UNIQUE_ITEM',
                                status: { in: ['OPEN', 'FINALIZING'] },
                                targetCode: { not: null },
                            },
                            select: { targetCode: true },
                        });
                        return rows.map((row) => row.targetCode);
                    }
                    return options.getAdditionalOccupiedUniqueItemKeys?.() ?? [];
                },
            });
            return immediateGeneralActionExecutor;
        },
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
        ensureDieOnPrestartStatus: (command) =>
            handleEnsureDieOnPrestartStatus(
                ctx,
                command as Extract<TurnDaemonCommand, { type: 'ensureDieOnPrestartStatus' }>
            ),
        dieOnPrestart: (command) =>
            handleDieOnPrestart(ctx, command as Extract<TurnDaemonCommand, { type: 'dieOnPrestart' }>),
        buildNationCandidate: (command) =>
            handleBuildNationCandidate(ctx, command as Extract<TurnDaemonCommand, { type: 'buildNationCandidate' }>),
        instantRetreat: (command) =>
            handleInstantRetreat(ctx, command as Extract<TurnDaemonCommand, { type: 'instantRetreat' }>),
        messageRespond: (command) =>
            handleMessageRespond(ctx, command as Extract<TurnDaemonCommand, { type: 'messageRespond' }>),
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
        adjustGeneralIcon: (command) =>
            handleAdjustGeneralIcon(ctx, command as Extract<TurnDaemonCommand, { type: 'adjustGeneralIcon' }>),
        joinCreateGeneral: (command) =>
            handleJoinCreateGeneral(ctx, command as Extract<TurnDaemonCommand, { type: 'joinCreateGeneral' }>),
        npcPossessGeneral: (command) =>
            handleNpcPossessGeneral(ctx, command as Extract<TurnDaemonCommand, { type: 'npcPossessGeneral' }>),
        selectPoolReserve: (command) =>
            handleSelectPoolReserve(ctx, command as Extract<TurnDaemonCommand, { type: 'selectPoolReserve' }>),
        selectPoolCreate: (command) =>
            handleSelectPoolCreate(ctx, command as Extract<TurnDaemonCommand, { type: 'selectPoolCreate' }>),
        selectPoolReselect: (command) =>
            handleSelectPoolReselect(ctx, command as Extract<TurnDaemonCommand, { type: 'selectPoolReselect' }>),
        shiftSchedule: (command) =>
            handleShiftSchedule(ctx, command as Extract<TurnDaemonCommand, { type: 'shiftSchedule' }>),
        updateRuntimeSettings: (command) =>
            handleUpdateRuntimeSettings(ctx, command as Extract<TurnDaemonCommand, { type: 'updateRuntimeSettings' }>),
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
