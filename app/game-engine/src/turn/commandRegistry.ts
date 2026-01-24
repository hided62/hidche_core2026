import { z } from 'zod';

import type {
    TurnDaemonCommand,
    TurnDaemonCommandType,
    TurnDaemonCommandByType,
} from '@sammo-ts/common';

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
});

const zAuctionBid = z.object({
    type: z.literal('auctionBid'),
    auctionId: zFiniteNumber,
    generalId: zFiniteNumber,
    amount: zFiniteNumber,
    tryExtendCloseDate: z.boolean().optional(),
});

const zTroopJoin = z.object({
    type: z.literal('troopJoin'),
    generalId: zFiniteNumber,
    troopId: zFiniteNumber,
});

const zTroopExit = z.object({
    type: z.literal('troopExit'),
    generalId: zFiniteNumber,
});

const zDieOnPrestart = z.object({
    type: z.literal('dieOnPrestart'),
    generalId: zFiniteNumber,
});

const zBuildNationCandidate = z.object({
    type: z.literal('buildNationCandidate'),
    generalId: zFiniteNumber,
});

const zInstantRetreat = z.object({
    type: z.literal('instantRetreat'),
    generalId: zFiniteNumber,
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

const zSetNationMeta = z.object({
    type: z.literal('setNationMeta'),
    nationId: zFiniteNumber,
    updates: zRecord,
    expectedUpdatedAt: z.string().optional(),
});

const zAdjustGeneralResources = z
    .object({
        type: z.literal('adjustGeneralResources'),
        reason: z.string().optional(),
        adjustments: z
            .array(
                z
                    .object({
                        generalId: zFiniteNumber,
                        goldDelta: zFiniteNumber.optional(),
                        riceDelta: zFiniteNumber.optional(),
                    })
                    .refine((value) => value.goldDelta !== undefined || value.riceDelta !== undefined)
            )
            .min(1),
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
        specialWar: z.string().optional(),
    }),
});

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

const normalizeAuctionFinalize: CommandNormalizer<'auctionFinalize'> = (envelope) => {
    const command = parseWith(zAuctionFinalize, envelope.command);
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

const normalizeTroopExit: CommandNormalizer<'troopExit'> = (envelope) => {
    const command = parseWith(zTroopExit, envelope.command);
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

const normalizePatchGeneral: CommandNormalizer<'patchGeneral'> = (envelope) => {
    const command = parseWith(zPatchGeneral, envelope.command);
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

const normalizeRun: CommandNormalizer<'run'> = (envelope) => parseWith(zRun, envelope.command);
const normalizePause: CommandNormalizer<'pause'> = (envelope) => parseWith(zPause, envelope.command);
const normalizeResume: CommandNormalizer<'resume'> = (envelope) => parseWith(zResume, envelope.command);
const normalizeShutdown: CommandNormalizer<'shutdown'> = (envelope) => parseWith(zShutdown, envelope.command);

const normalizers: CommandNormalizerMap = {
    auctionFinalize: normalizeAuctionFinalize,
    auctionBid: normalizeAuctionBid,
    troopJoin: normalizeTroopJoin,
    troopExit: normalizeTroopExit,
    dieOnPrestart: normalizeDieOnPrestart,
    buildNationCandidate: normalizeBuildNationCandidate,
    instantRetreat: normalizeInstantRetreat,
    vacation: normalizeVacation,
    setMySetting: normalizeSetMySetting,
    dropItem: normalizeDropItem,
    changePermission: normalizeChangePermission,
    kick: normalizeKick,
    appoint: normalizeAppoint,
    tournamentRefund: normalizeTournamentRefund,
    tournamentBettingPayout: normalizeTournamentBettingPayout,
    tournamentReward: normalizeTournamentReward,
    setNationMeta: normalizeSetNationMeta,
    adjustGeneralResources: normalizeAdjustGeneralResources,
    patchGeneral: normalizePatchGeneral,
    getStatus: normalizeGetStatus,
    run: normalizeRun,
    pause: normalizePause,
    resume: normalizeResume,
    shutdown: normalizeShutdown,
};

export const normalizeTurnDaemonCommand = (envelope: TurnDaemonCommandEnvelope): TurnDaemonCommand | null => {
    const commandType = envelope.command.type as TurnDaemonCommandType;
    const normalizer = normalizers[commandType];
    if (!normalizer) {
        return null;
    }
    return normalizer(envelope) as TurnDaemonCommand | null;
};
