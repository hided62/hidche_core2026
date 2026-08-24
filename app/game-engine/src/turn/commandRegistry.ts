import { z } from 'zod';

import type { TurnDaemonCommand, TurnDaemonCommandType, TurnDaemonCommandByType } from '@sammo-ts/common';
import { isCanonicalIsoTimestamp } from '@sammo-ts/common';

export type TurnDaemonCommandEnvelope = {
    requestId: string;
    sentAt: string;
    command: TurnDaemonCommand;
};

type CommandNormalizer<T extends TurnDaemonCommandType> = (
    envelope: TurnDaemonCommandEnvelope
) => TurnDaemonCommandByType<T> | null;

type CommandNormalizerMap = {
    [T in TurnDaemonCommandType]?: CommandNormalizer<T>;
};

const parseWith = <T>(schema: z.ZodType<T>, value: unknown): T | null => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
};

const zFiniteNumber = z.number().finite();
const zSafeInteger = zFiniteNumber.int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const zRecord = z.record(z.string(), z.unknown());

const zRunReason = z.enum(['schedule', 'manual', 'poke']);
const zTurnRunBudget = z.object({
    budgetMs: z.number().int().positive(),
    maxGenerals: z.number().int().positive(),
    catchUpCap: z.number().int().positive(),
});

const zAuctionFinalize = z.object({
    type: z.literal('auctionFinalize'),
    auctionId: zFiniteNumber,
    expectedCloseAt: z.string().refine(isCanonicalIsoTimestamp).optional(),
    expectedCloseTick: zSafeInteger.optional(),
});

const zAuctionOpen = z.object({
    type: z.literal('auctionOpen'),
    generalId: zFiniteNumber,
    auctionType: z.enum(['BUY_RICE', 'SELL_RICE', 'UNIQUE_ITEM']),
    amount: zFiniteNumber,
    closeTurnCnt: zFiniteNumber.optional(),
    startBidAmount: zFiniteNumber.optional(),
    finishBidAmount: zFiniteNumber.optional(),
    itemKey: z.string().optional(),
});

const zAuctionBid = z.object({
    type: z.literal('auctionBid'),
    auctionId: zFiniteNumber,
    generalId: zFiniteNumber,
    amount: zFiniteNumber,
    acceptedGameTick: zSafeInteger.optional(),
    tryExtendCloseDate: z.boolean().optional(),
});

const zTroopJoin = z.object({
    type: z.literal('troopJoin'),
    generalId: zFiniteNumber,
    troopId: zFiniteNumber,
});

const zTroopCreate = z.object({
    type: z.literal('troopCreate'),
    generalId: zFiniteNumber,
    troopName: z.string(),
});

const zTroopExit = z.object({
    type: z.literal('troopExit'),
    generalId: zFiniteNumber,
});

const zTroopKick = z.object({
    type: z.literal('troopKick'),
    generalId: zFiniteNumber,
    troopId: zFiniteNumber,
    targetGeneralId: zFiniteNumber,
});

const zTroopRename = z.object({
    type: z.literal('troopRename'),
    generalId: zFiniteNumber,
    troopId: zFiniteNumber,
    troopName: z.string(),
});

const zDieOnPrestart = z.object({
    type: z.literal('dieOnPrestart'),
    userId: z.string().min(1),
    generalId: zFiniteNumber,
});

const zEnsureDieOnPrestartStatus = z.object({
    type: z.literal('ensureDieOnPrestartStatus'),
    userId: z.string().min(1),
    generalId: zFiniteNumber,
});

const zBuildNationCandidate = z.object({
    type: z.literal('buildNationCandidate'),
    userId: z.string().min(1),
    generalId: zFiniteNumber,
});

const zInstantRetreat = z.object({
    type: z.literal('instantRetreat'),
    userId: z.string().min(1),
    generalId: zFiniteNumber,
});

const zMessageRespond = z.object({
    type: z.literal('messageRespond'),
    userId: z.string().min(1),
    generalId: z.number().int().positive(),
    messageId: z.number().int().positive(),
    response: z.boolean(),
});

const zVacation = z.object({
    type: z.literal('vacation'),
    generalId: zFiniteNumber,
});

const zSetMySetting = z.object({
    type: z.literal('setMySetting'),
    generalId: zFiniteNumber,
    settings: z.object({
        tnmt: z.number().int().optional(),
        defence_train: z.number().int().optional(),
        use_treatment: z.number().int().optional(),
        use_auto_nation_turn: z.number().int().optional(),
        use_auto_nation_diplomacy: z.number().int().optional(),
        use_auto_nation_war: z.number().int().optional(),
        use_auto_nation_promotion: z.number().int().optional(),
        use_auto_nation_finance: z.number().int().optional(),
        use_auto_nation_capital: z.number().int().optional(),
    }),
});

const zDropItem = z.object({
    type: z.literal('dropItem'),
    generalId: zFiniteNumber,
    itemType: z.string().min(1),
});

const zChangePermission = z.object({
    type: z.literal('changePermission'),
    generalId: zFiniteNumber,
    isAmbassador: z.boolean(),
    targetGeneralIds: z.array(zFiniteNumber).min(1),
});

const zKick = z.object({
    type: z.literal('kick'),
    generalId: zFiniteNumber,
    destGeneralId: zFiniteNumber,
});

const zAppoint = z.object({
    type: z.literal('appoint'),
    generalId: zFiniteNumber,
    destGeneralId: zFiniteNumber,
    destCityId: zFiniteNumber,
    officerLevel: zFiniteNumber,
});

const zTournamentRefund = z.object({
    type: z.literal('tournamentRefund'),
    bettingId: zFiniteNumber.optional(),
    reason: z.string().optional(),
    refunds: z.array(z.object({ generalId: zFiniteNumber, amount: zFiniteNumber })).min(1),
});

const zTournamentBettingPayout = z.object({
    type: z.literal('tournamentBettingPayout'),
    bettingId: zFiniteNumber.optional(),
    tournamentType: zFiniteNumber.optional(),
    reason: z.string().optional(),
    payouts: z.array(z.object({ generalId: zFiniteNumber, amount: zFiniteNumber })).min(1),
});

const zTournamentReward = z.object({
    type: z.literal('tournamentReward'),
    tournamentType: zFiniteNumber,
    winnerId: zFiniteNumber,
    runnerUpId: zFiniteNumber,
    top16: z.array(zFiniteNumber).min(1),
    top8: z.array(zFiniteNumber),
    top4: z.array(zFiniteNumber),
});

const zVoteReward = z.object({
    type: z.literal('voteReward'),
    voteId: zFiniteNumber,
    generalId: zFiniteNumber,
    selection: z.array(zFiniteNumber.int()).min(1),
    acceptedGameTick: zSafeInteger.optional(),
});

const zSetNationMeta = z.object({
    type: z.literal('setNationMeta'),
    nationId: zFiniteNumber,
    updates: zRecord,
    expectedUpdatedAt: z.string().optional(),
});

const zAdjustGeneralResources = z.object({
    type: z.literal('adjustGeneralResources'),
    reason: z.string().optional(),
    adjustments: z
        .array(
            z
                .object({
                    generalId: zFiniteNumber,
                    goldDelta: zFiniteNumber.optional(),
                    riceDelta: zFiniteNumber.optional(),
                    minGoldAfter: zFiniteNumber.optional(),
                })
                .refine((value) => value.goldDelta !== undefined || value.riceDelta !== undefined)
        )
        .min(1),
});

const zAdjustGeneralMeta = z.object({
    type: z.literal('adjustGeneralMeta'),
    reason: z.string().optional(),
    adjustments: z
        .array(
            z.object({
                generalId: zFiniteNumber,
                metaDelta: z.record(z.string(), zFiniteNumber),
            })
        )
        .min(1),
});

const zTournamentMatchResult = z.object({
    type: z.literal('tournamentMatchResult'),
    tournamentType: zFiniteNumber,
    attackerId: zFiniteNumber,
    defenderId: zFiniteNumber,
    result: z.enum(['attacker', 'defender', 'draw']),
});

const zPatchGeneral = z.object({
    type: z.literal('patchGeneral'),
    generalId: zFiniteNumber,
    patch: z.object({
        meta: zRecord.optional(),
        turnTime: z.string().optional(),
        stats: z
            .object({
                leadership: zFiniteNumber.optional(),
                strength: zFiniteNumber.optional(),
                intelligence: zFiniteNumber.optional(),
            })
            .optional(),
        specialWar: z.string().nullable().optional(),
    }),
});

const zInheritanceAction = z
    .object({
        type: z.literal('inheritanceAction'),
        requestId: z.string().min(1).optional(),
        userId: z.string().min(1),
        input: z.discriminatedUnion('action', [
            z.object({
                action: z.literal('buyHiddenBuff'),
                buffType: z.enum([
                    'warAvoidRatio',
                    'warCriticalRatio',
                    'warMagicTrialProb',
                    'domesticSuccessProb',
                    'domesticFailProb',
                    'warAvoidRatioOppose',
                    'warCriticalRatioOppose',
                    'warMagicTrialProbOppose',
                ]),
                level: z.number().int().min(1).max(5),
            }),
            z.object({ action: z.literal('setNextSpecialWar'), specialKey: z.string().min(1) }),
            z.object({ action: z.literal('resetSpecialWar') }),
            z.object({ action: z.literal('resetTurnTime') }),
            z.object({
                action: z.literal('resetStat'),
                leadership: z.number().int(),
                strength: z.number().int(),
                intel: z.number().int(),
                inheritBonusStat: z.tuple([z.number().int(), z.number().int(), z.number().int()]).optional(),
            }),
            z.object({ action: z.literal('buyRandomUnique') }),
            z.object({ action: z.literal('checkOwner'), targetGeneralId: z.number().int().positive() }),
        ]),
    })
    .strict();

const zAdjustGeneralIcon = z
    .object({
        type: z.literal('adjustGeneralIcon'),
        requestId: z.string().min(1).optional(),
        userId: z.string().min(1),
        picture: z.string().min(1),
        imageServer: z.number().int().nonnegative(),
        iconRevision: z.string().refine(isCanonicalIsoTimestamp),
        enforceCooldown: z.boolean().optional(),
    })
    .strict();

const zJoinCreateGeneral = z
    .object({
        type: z.literal('joinCreateGeneral'),
        requestId: z.string().optional(),
        userId: z.string().min(1),
        ownerDisplayName: z.string(),
        seedOwnerIdentity: z.union([z.string().min(1), zFiniteNumber]),
        name: z.string().min(1).max(18),
        leadership: zFiniteNumber,
        strength: zFiniteNumber,
        intel: zFiniteNumber,
        pic: z.boolean(),
        character: z.string().min(1),
        profileId: z.string().min(1),
        ownerPicture: z.string().optional(),
        ownerImageServer: zFiniteNumber.optional(),
        ownerIconRevision: z.string().refine(isCanonicalIsoTimestamp).optional(),
        ownerCanUsePicture: z.boolean().optional(),
        ownerLegacyPenalty: zRecord.optional(),
        inheritSpecial: z.string().optional(),
        inheritTurntimeZone: zFiniteNumber.optional(),
        inheritCity: zFiniteNumber.optional(),
        inheritBonusStat: z.tuple([zFiniteNumber, zFiniteNumber, zFiniteNumber]).optional(),
    })
    .strict();

const zNpcPossessGeneral = z
    .object({
        type: z.literal('npcPossessGeneral'),
        requestId: z.string().optional(),
        userId: z.string().min(1),
        ownerDisplayName: z.string(),
        profileId: z.string().min(1),
        ownerLegacyPenalty: zRecord.optional(),
        generalId: z.number().int().positive(),
        tokenNonce: z.number().int().nonnegative(),
        acceptedGameAt: z.string().refine(isCanonicalIsoTimestamp).optional(),
    })
    .strict();

const zSelectPoolCreate = z
    .object({
        type: z.literal('selectPoolCreate'),
        requestId: z.string().optional(),
        userId: z.string().min(1),
        ownerDisplayName: z.string().min(1),
        uniqueName: z.string().min(1).max(20),
        personality: z.string().min(1),
        seedOwnerIdentity: z.union([z.string().min(1), zFiniteNumber]),
        ownerPicture: z.string().optional(),
        ownerImageServer: z.number().int().nonnegative().optional(),
        ownerIconRevision: z.string().refine(isCanonicalIsoTimestamp).optional(),
        acceptedGameAt: z.string().refine(isCanonicalIsoTimestamp).optional(),
        acceptedGameTick: zFiniteNumber.int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict();

const zSelectPoolReserve = z
    .object({
        type: z.literal('selectPoolReserve'),
        requestId: z.string().optional(),
        userId: z.string().min(1),
        seedOwnerIdentity: z.union([z.string().min(1), zFiniteNumber]),
        acceptedGameAt: z.string().refine(isCanonicalIsoTimestamp),
        acceptedGameTick: zFiniteNumber.int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict();

const zSelectPoolReselect = z
    .object({
        type: z.literal('selectPoolReselect'),
        requestId: z.string().optional(),
        userId: z.string().min(1),
        ownerDisplayName: z.string().min(1),
        uniqueName: z.string().min(1).max(20),
        acceptedGameAt: z.string().refine(isCanonicalIsoTimestamp).optional(),
        acceptedGameTick: zFiniteNumber.int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict();

const zGetStatus = z.object({
    type: z.literal('getStatus'),
    requestId: z.string().optional(),
});

const zRun = z.object({
    type: z.literal('run'),
    reason: zRunReason,
    targetTime: z.string().optional(),
    budget: zTurnRunBudget.optional(),
});

const zPause = z.object({
    type: z.literal('pause'),
    reason: z.string().optional(),
});

const zResume = z.object({
    type: z.literal('resume'),
    reason: z.string().optional(),
});

const zShutdown = z.object({
    type: z.literal('shutdown'),
    reason: z.string().optional(),
});

const zShiftSchedule = z.object({
    type: z.literal('shiftSchedule'),
    actionId: z.string().uuid(),
    deltaMinutes: z
        .number()
        .int()
        .min(-1440)
        .max(1440)
        .refine((value) => value !== 0),
});

const zRuntimeAutorunOption = z.enum(['develop', 'warp', 'recruit', 'recruit_high', 'train', 'battle', 'chief']);

const zUpdateRuntimeSettings = z.object({
    type: z.literal('updateRuntimeSettings'),
    actionId: z.string().uuid(),
    settings: z
        .object({
            turnTermMinutes: z
                .number()
                .int()
                .refine((value) => [1, 2, 5, 10, 20, 30, 60, 120].includes(value))
                .optional(),
            blockGeneralCreate: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
            autorunUser: z
                .object({
                    limitMinutes: z.number().int().min(1).max(43200),
                    options: z.array(zRuntimeAutorunOption).min(1),
                })
                .nullable()
                .optional(),
        })
        .refine((settings) => Object.values(settings).some((value) => value !== undefined)),
});

const normalizeAuctionFinalize: CommandNormalizer<'auctionFinalize'> = (envelope) => {
    const command = parseWith(zAuctionFinalize, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeAuctionOpen: CommandNormalizer<'auctionOpen'> = (envelope) => {
    const command = parseWith(zAuctionOpen, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeAuctionBid: CommandNormalizer<'auctionBid'> = (envelope) => {
    const command = parseWith(zAuctionBid, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeTroopJoin: CommandNormalizer<'troopJoin'> = (envelope) => {
    const command = parseWith(zTroopJoin, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeTroopCreate: CommandNormalizer<'troopCreate'> = (envelope) => {
    const command = parseWith(zTroopCreate, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeTroopExit: CommandNormalizer<'troopExit'> = (envelope) => {
    const command = parseWith(zTroopExit, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeTroopKick: CommandNormalizer<'troopKick'> = (envelope) => {
    const command = parseWith(zTroopKick, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeTroopRename: CommandNormalizer<'troopRename'> = (envelope) => {
    const command = parseWith(zTroopRename, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeDieOnPrestart: CommandNormalizer<'dieOnPrestart'> = (envelope) => {
    const command = parseWith(zDieOnPrestart, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeEnsureDieOnPrestartStatus: CommandNormalizer<'ensureDieOnPrestartStatus'> = (envelope) => {
    const command = parseWith(zEnsureDieOnPrestartStatus, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeBuildNationCandidate: CommandNormalizer<'buildNationCandidate'> = (envelope) => {
    const command = parseWith(zBuildNationCandidate, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeInstantRetreat: CommandNormalizer<'instantRetreat'> = (envelope) => {
    const command = parseWith(zInstantRetreat, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeMessageRespond: CommandNormalizer<'messageRespond'> = (envelope) => {
    const command = parseWith(zMessageRespond, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeVacation: CommandNormalizer<'vacation'> = (envelope) => {
    const command = parseWith(zVacation, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeSetMySetting: CommandNormalizer<'setMySetting'> = (envelope) => {
    const command = parseWith(zSetMySetting, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeDropItem: CommandNormalizer<'dropItem'> = (envelope) => {
    const command = parseWith(zDropItem, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeChangePermission: CommandNormalizer<'changePermission'> = (envelope) => {
    const command = parseWith(zChangePermission, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeKick: CommandNormalizer<'kick'> = (envelope) => {
    const command = parseWith(zKick, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeAppoint: CommandNormalizer<'appoint'> = (envelope) => {
    const command = parseWith(zAppoint, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeTournamentRefund: CommandNormalizer<'tournamentRefund'> = (envelope) => {
    const command = parseWith(zTournamentRefund, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeTournamentBettingPayout: CommandNormalizer<'tournamentBettingPayout'> = (envelope) => {
    const command = parseWith(zTournamentBettingPayout, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeTournamentReward: CommandNormalizer<'tournamentReward'> = (envelope) => {
    const command = parseWith(zTournamentReward, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeVoteReward: CommandNormalizer<'voteReward'> = (envelope) => {
    const command = parseWith(zVoteReward, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeSetNationMeta: CommandNormalizer<'setNationMeta'> = (envelope) => {
    const command = parseWith(zSetNationMeta, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeAdjustGeneralResources: CommandNormalizer<'adjustGeneralResources'> = (envelope) => {
    const command = parseWith(zAdjustGeneralResources, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeAdjustGeneralMeta: CommandNormalizer<'adjustGeneralMeta'> = (envelope) => {
    const command = parseWith(zAdjustGeneralMeta, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeTournamentMatchResult: CommandNormalizer<'tournamentMatchResult'> = (envelope) => {
    const command = parseWith(zTournamentMatchResult, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizePatchGeneral: CommandNormalizer<'patchGeneral'> = (envelope) => {
    const command = parseWith(zPatchGeneral, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeInheritanceAction: CommandNormalizer<'inheritanceAction'> = (envelope) => {
    const command = parseWith(zInheritanceAction, envelope.command);
    if (!command || (command.requestId !== undefined && command.requestId !== envelope.requestId)) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeAdjustGeneralIcon: CommandNormalizer<'adjustGeneralIcon'> = (envelope) => {
    const command = parseWith(zAdjustGeneralIcon, envelope.command);
    if (!command || (command.requestId !== undefined && command.requestId !== envelope.requestId)) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeJoinCreateGeneral: CommandNormalizer<'joinCreateGeneral'> = (envelope) => {
    const command = parseWith(zJoinCreateGeneral, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeNpcPossessGeneral: CommandNormalizer<'npcPossessGeneral'> = (envelope) => {
    const command = parseWith(zNpcPossessGeneral, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeSelectPoolCreate: CommandNormalizer<'selectPoolCreate'> = (envelope) => {
    const command = parseWith(zSelectPoolCreate, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeSelectPoolReserve: CommandNormalizer<'selectPoolReserve'> = (envelope) => {
    const command = parseWith(zSelectPoolReserve, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeSelectPoolReselect: CommandNormalizer<'selectPoolReselect'> = (envelope) => {
    const command = parseWith(zSelectPoolReselect, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeGetStatus: CommandNormalizer<'getStatus'> = (envelope) => {
    const command = parseWith(zGetStatus, envelope.command);
    if (!command) {
        return null;
    }
    return {
        type: 'getStatus',
        requestId: command.requestId ?? envelope.requestId,
    };
};

const normalizeRun: CommandNormalizer<'run'> = (envelope) => {
    const command = parseWith(zRun, envelope.command);
    return command ? { ...command, requestId: envelope.requestId } : null;
};
const normalizePause: CommandNormalizer<'pause'> = (envelope) => {
    const command = parseWith(zPause, envelope.command);
    return command ? { ...command, requestId: envelope.requestId } : null;
};
const normalizeResume: CommandNormalizer<'resume'> = (envelope) => {
    const command = parseWith(zResume, envelope.command);
    return command ? { ...command, requestId: envelope.requestId } : null;
};
const normalizeShutdown: CommandNormalizer<'shutdown'> = (envelope) => {
    const command = parseWith(zShutdown, envelope.command);
    return command ? { ...command, requestId: envelope.requestId } : null;
};

const normalizeShiftSchedule: CommandNormalizer<'shiftSchedule'> = (envelope) => {
    const command = parseWith(zShiftSchedule, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizeUpdateRuntimeSettings: CommandNormalizer<'updateRuntimeSettings'> = (envelope) => {
    const command = parseWith(zUpdateRuntimeSettings, envelope.command);
    if (!command) {
        return null;
    }
    return { ...command, requestId: envelope.requestId };
};

const normalizers: CommandNormalizerMap = {
    auctionFinalize: normalizeAuctionFinalize,
    auctionOpen: normalizeAuctionOpen,
    auctionBid: normalizeAuctionBid,
    troopCreate: normalizeTroopCreate,
    troopJoin: normalizeTroopJoin,
    troopExit: normalizeTroopExit,
    troopKick: normalizeTroopKick,
    troopRename: normalizeTroopRename,
    dieOnPrestart: normalizeDieOnPrestart,
    ensureDieOnPrestartStatus: normalizeEnsureDieOnPrestartStatus,
    buildNationCandidate: normalizeBuildNationCandidate,
    instantRetreat: normalizeInstantRetreat,
    messageRespond: normalizeMessageRespond,
    vacation: normalizeVacation,
    setMySetting: normalizeSetMySetting,
    dropItem: normalizeDropItem,
    changePermission: normalizeChangePermission,
    kick: normalizeKick,
    appoint: normalizeAppoint,
    tournamentRefund: normalizeTournamentRefund,
    tournamentBettingPayout: normalizeTournamentBettingPayout,
    tournamentReward: normalizeTournamentReward,
    voteReward: normalizeVoteReward,
    setNationMeta: normalizeSetNationMeta,
    adjustGeneralResources: normalizeAdjustGeneralResources,
    adjustGeneralMeta: normalizeAdjustGeneralMeta,
    tournamentMatchResult: normalizeTournamentMatchResult,
    patchGeneral: normalizePatchGeneral,
    inheritanceAction: normalizeInheritanceAction,
    adjustGeneralIcon: normalizeAdjustGeneralIcon,
    joinCreateGeneral: normalizeJoinCreateGeneral,
    npcPossessGeneral: normalizeNpcPossessGeneral,
    selectPoolReserve: normalizeSelectPoolReserve,
    selectPoolCreate: normalizeSelectPoolCreate,
    selectPoolReselect: normalizeSelectPoolReselect,
    getStatus: normalizeGetStatus,
    run: normalizeRun,
    pause: normalizePause,
    resume: normalizeResume,
    shutdown: normalizeShutdown,
    shiftSchedule: normalizeShiftSchedule,
    updateRuntimeSettings: normalizeUpdateRuntimeSettings,
};

export const normalizeTurnDaemonCommand = (envelope: TurnDaemonCommandEnvelope): TurnDaemonCommand | null => {
    const commandType = envelope.command.type as TurnDaemonCommandType;
    const normalizer = normalizers[commandType];
    if (!normalizer) {
        return null;
    }
    return normalizer(envelope) as TurnDaemonCommand | null;
};
