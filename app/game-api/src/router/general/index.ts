import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { LogCategory, LogScope } from '@sammo-ts/infra';
import { asRecord } from '@sammo-ts/common';

import type { GameApiContext } from '../../context.js';
import { authedProcedure, engineAuthedProcedure, router } from '../../trpc.js';
import { ConflictingTurnDaemonCommandError } from '../../daemon/databaseTransport.js';
import { resolveAccessWindows } from '../../services/generalAccess.js';
import { getMyGeneral } from '../shared/general.js';
import { resolveNationNotice } from '../nation/shared.js';

const zGeneralSettings = z.object({
    tnmt: z.number().int().optional(),
    defence_train: z.number().int().optional(),
    use_treatment: z.number().int().optional(),
    use_auto_nation_turn: z.number().int().optional(),
});

const zGeneralLogType = z.enum(['generalHistory', 'battleDetail', 'battleResult', 'generalAction']);
const zImmediateActionInput = z
    .object({
        clientRequestId: z.string().uuid().optional(),
    })
    .optional();
const MAIN_RECORD_LIMIT = 15;

const resolveImmediateActionRequestId = (
    contextRequestId: string | undefined,
    userId: string,
    clientRequestId: string | undefined,
    action: 'buildNationCandidate' | 'instantRetreat'
): string | undefined => {
    if (clientRequestId) {
        return `general:${action}:${userId}:${clientRequestId}`;
    }
    return contextRequestId ? `${contextRequestId}:general.${action}` : undefined;
};

const requestImmediateAction = async (
    ctx: GameApiContext,
    input: { clientRequestId?: string } | undefined,
    action: 'buildNationCandidate' | 'instantRetreat'
): Promise<{ ok: true }> => {
    const userId = ctx.auth?.user.id;
    if (!userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    const general = await getMyGeneral(ctx);
    const requestId = resolveImmediateActionRequestId(ctx.requestId, userId, input?.clientRequestId, action);
    try {
        const result = await ctx.turnDaemon.requestCommand({
            type: action,
            ...(requestId ? { requestId } : {}),
            userId,
            generalId: general.id,
        });
        if (!result) {
            throw new TRPCError({
                code: 'TIMEOUT',
                message: '요청은 접수됐지만 처리 결과를 아직 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.',
            });
        }
        if (result.type !== action) {
            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: '턴 데몬이 올바르지 않은 즉시 행동 결과를 반환했습니다.',
            });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }
        return { ok: true };
    } catch (error) {
        if (
            error instanceof ConflictingTurnDaemonCommandError ||
            (error instanceof Error && error.name === 'ConflictingTurnDaemonCommandError')
        ) {
            throw new TRPCError({
                code: 'CONFLICT',
                message: '이미 접수된 즉시 행동 요청과 입력이 다릅니다. 새 요청 번호로 다시 시도해 주세요.',
            });
        }
        throw error;
    }
};

const trimRecentRecords = <Entry extends { id: number }>(entries: Entry[], cursor: number): Entry[] => {
    if (entries.length === 0) {
        return entries;
    }
    const result = [...entries];
    if (result.at(-1)?.id === cursor || result.length > MAIN_RECORD_LIMIT) {
        result.pop();
    }
    return result;
};

const readNumber = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const normalizeItemCode = (value: string | null): string | null => {
    if (!value || value === 'None') {
        return null;
    }
    return value;
};

const resolveUserSettings = (meta: Record<string, unknown>) => {
    // The legacy general columns are persisted at the top level of General.meta.
    // Keep reading the short-lived nested shape for installations that ran the
    // initial rewrite implementation before this compatibility fix.
    const nestedSettings = asRecord(meta.userSettings);
    const readSetting = (key: string): unknown => meta[key] ?? nestedSettings[key];
    const mysetRaw = readSetting('myset');
    const myset = typeof mysetRaw === 'number' && Number.isFinite(mysetRaw) ? mysetRaw : null;

    return {
        tnmt: readNumber(readSetting('tnmt'), 1),
        defence_train: readNumber(readSetting('defence_train'), 80),
        use_treatment: readNumber(readSetting('use_treatment'), 10),
        use_auto_nation_turn: readNumber(readSetting('use_auto_nation_turn'), 1),
        myset,
    };
};

const resolvePenalty = (penalty: unknown): Record<string, number> => {
    const penaltyRecord = asRecord(penalty);
    const result: Record<string, number> = {};

    for (const [key, value] of Object.entries(penaltyRecord)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            result[key] = value;
            continue;
        }
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                result[key] = parsed;
            }
        }
    }

    return result;
};

export const generalRouter = router({
    me: authedProcedure.query(async ({ ctx }) => {
        const userId = ctx.auth?.user.id;
        if (!userId) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
        }

        const general = await ctx.db.general.findFirst({
            where: { userId },
            select: {
                id: true,
                name: true,
                npcState: true,
                nationId: true,
                cityId: true,
                troopId: true,
                picture: true,
                imageServer: true,
                leadership: true,
                strength: true,
                intel: true,
                officerLevel: true,
                gold: true,
                rice: true,
                crew: true,
                train: true,
                atmos: true,
                injury: true,
                experience: true,
                dedication: true,
                weaponCode: true,
                horseCode: true,
                bookCode: true,
                itemCode: true,
                meta: true,
                penalty: true,
            },
        });

        if (!general) {
            return null;
        }

        const [city, nation] = await Promise.all([
            general.cityId > 0
                ? ctx.db.city.findUnique({
                      where: { id: general.cityId },
                      select: {
                          id: true,
                          name: true,
                          level: true,
                          nationId: true,
                          population: true,
                          agriculture: true,
                          commerce: true,
                          security: true,
                          defence: true,
                          wall: true,
                          supplyState: true,
                          frontState: true,
                      },
                  })
                : null,
            general.nationId > 0
                ? ctx.db.nation.findUnique({
                      where: { id: general.nationId },
                      select: {
                          id: true,
                          name: true,
                          color: true,
                          level: true,
                          gold: true,
                          rice: true,
                          tech: true,
                          typeCode: true,
                          capitalCityId: true,
                      },
                  })
                : null,
        ]);

        const metaRecord = asRecord(general.meta);
        const settings = resolveUserSettings(metaRecord);
        const penalties = resolvePenalty(general.penalty);

        return {
            general: {
                id: general.id,
                name: general.name,
                npcState: general.npcState,
                nationId: general.nationId,
                cityId: general.cityId,
                troopId: general.troopId,
                picture: general.picture,
                imageServer: general.imageServer,
                officerLevel: general.officerLevel,
                stats: {
                    leadership: general.leadership,
                    strength: general.strength,
                    intelligence: general.intel,
                },
                gold: general.gold,
                rice: general.rice,
                crew: general.crew,
                train: general.train,
                atmos: general.atmos,
                injury: general.injury,
                experience: general.experience,
                dedication: general.dedication,
                items: {
                    horse: normalizeItemCode(general.horseCode),
                    weapon: normalizeItemCode(general.weaponCode),
                    book: normalizeItemCode(general.bookCode),
                    item: normalizeItemCode(general.itemCode),
                },
            },
            city,
            nation,
            settings,
            penalties,
        };
    }),
    dieOnPrestart: authedProcedure.mutation(async ({ ctx }) => {
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'dieOnPrestart',
            generalId: general.id,
        });
        if (!result || result.type !== 'dieOnPrestart') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }
        return { ok: true };
    }),
    buildNationCandidate: engineAuthedProcedure
        .input(zImmediateActionInput)
        .mutation(({ ctx, input }) => requestImmediateAction(ctx, input, 'buildNationCandidate')),
    instantRetreat: engineAuthedProcedure
        .input(zImmediateActionInput)
        .mutation(({ ctx, input }) => requestImmediateAction(ctx, input, 'instantRetreat')),
    vacation: authedProcedure.mutation(async ({ ctx }) => {
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'vacation',
            generalId: general.id,
        });
        if (!result || result.type !== 'vacation') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }
        return { ok: true };
    }),
    setMySetting: authedProcedure.input(zGeneralSettings).mutation(async ({ ctx, input }) => {
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'setMySetting',
            generalId: general.id,
            settings: input,
        });
        if (!result || result.type !== 'setMySetting') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }

        return { ok: true };
    }),
    dropItem: authedProcedure.input(z.object({ itemType: z.string() })).mutation(async ({ ctx, input }) => {
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'dropItem',
            generalId: general.id,
            itemType: input.itemType,
        });
        if (!result || result.type !== 'dropItem') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }
        return { ok: true };
    }),
    getMyLog: authedProcedure
        .input(
            z.object({
                type: zGeneralLogType,
                beforeId: z.number().int().positive().optional(),
            })
        )
        .query(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);

            const categoryMap: Record<z.infer<typeof zGeneralLogType>, LogCategory> = {
                generalHistory: LogCategory.HISTORY,
                generalAction: LogCategory.ACTION,
                battleResult: LogCategory.BATTLE_BRIEF,
                battleDetail: LogCategory.BATTLE_DETAIL,
            };

            const logs = await ctx.db.logEntry.findMany({
                where: {
                    generalId: me.id,
                    scope: LogScope.GENERAL,
                    category: categoryMap[input.type],
                    ...(input.beforeId ? { id: { lt: input.beforeId } } : {}),
                },
                orderBy: { id: 'desc' },
                take: 24,
            });

            return {
                type: input.type,
                logs: logs.map((entry) => ({
                    id: entry.id,
                    text: entry.text,
                })),
            };
        }),
    getRecentRecords: authedProcedure
        .input(
            z.object({
                lastGeneralRecordId: z.number().int().nonnegative().default(0),
                lastWorldHistoryId: z.number().int().nonnegative().default(0),
            })
        )
        .query(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            const take = MAIN_RECORD_LIMIT + 1;
            const [global, general, history] = await Promise.all([
                ctx.db.logEntry.findMany({
                    where: {
                        scope: LogScope.SYSTEM,
                        category: LogCategory.SUMMARY,
                        id: { gte: input.lastGeneralRecordId },
                    },
                    orderBy: { id: 'desc' },
                    take,
                    select: { id: true, text: true },
                }),
                ctx.db.logEntry.findMany({
                    where: {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        generalId: me.id,
                        id: { gte: input.lastGeneralRecordId },
                    },
                    orderBy: { id: 'desc' },
                    take,
                    select: { id: true, text: true },
                }),
                ctx.db.logEntry.findMany({
                    where: {
                        scope: LogScope.SYSTEM,
                        category: LogCategory.HISTORY,
                        id: { gte: input.lastWorldHistoryId },
                    },
                    orderBy: { id: 'desc' },
                    take,
                    select: { id: true, text: true },
                }),
            ]);

            return {
                global: trimRecentRecords(global, input.lastGeneralRecordId),
                general: trimRecentRecords(general, input.lastGeneralRecordId),
                history: trimRecentRecords(history, input.lastWorldHistoryId),
            };
        }),
    getFrontStatus: authedProcedure.query(async ({ ctx }) => {
        const me = await getMyGeneral(ctx);
        const worldState = await ctx.db.worldState.findFirst({
            orderBy: { id: 'asc' },
            select: {
                tickSeconds: true,
                meta: true,
            },
        });
        if (!worldState) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'World state is not initialized.' });
        }

        const now = new Date();
        const { scoreStartedAt } = resolveAccessWindows(now, worldState.tickSeconds, worldState.meta);
        const [onlineAccess, ownNation, latestVote] = await Promise.all([
            ctx.db.generalAccessLog.findMany({
                where: {
                    lastRefresh: {
                        gte: scoreStartedAt,
                    },
                },
                select: { generalId: true },
            }),
            me.nationId > 0
                ? ctx.db.nation.findUnique({
                      where: { id: me.nationId },
                      select: { meta: true },
                  })
                : Promise.resolve(null),
            ctx.db.votePoll.findFirst({
                where: {
                    startAt: { lte: now },
                    closedAt: null,
                    OR: [{ endAt: null }, { endAt: { gte: now } }],
                },
                orderBy: { id: 'desc' },
                select: {
                    id: true,
                    title: true,
                },
            }),
        ]);

        const onlineGeneralIds = onlineAccess.map((entry) => entry.generalId);
        const onlineGenerals =
            onlineGeneralIds.length > 0
                ? await ctx.db.general.findMany({
                      where: { id: { in: onlineGeneralIds } },
                      orderBy: { id: 'asc' },
                      select: {
                          id: true,
                          name: true,
                          nationId: true,
                      },
                  })
                : [];
        const nationIds = [...new Set(onlineGenerals.map((general) => general.nationId).filter((id) => id > 0))];
        const nations =
            nationIds.length > 0
                ? await ctx.db.nation.findMany({
                      where: { id: { in: nationIds } },
                      select: {
                          id: true,
                          name: true,
                      },
                  })
                : [];
        const nationNames = new Map(nations.map((nation) => [nation.id, nation.name]));
        const onlineByNation = new Map<number, typeof onlineGenerals>();
        for (const general of onlineGenerals) {
            const bucket = onlineByNation.get(general.nationId) ?? [];
            bucket.push(general);
            onlineByNation.set(general.nationId, bucket);
        }
        const onlineNations = [...onlineByNation.entries()]
            .sort((left, right) => right[1].length - left[1].length || left[0] - right[0])
            .map(([nationId]) => `【${nationId === 0 ? '재야' : (nationNames.get(nationId) ?? `세력 ${nationId}`)}】`)
            .join(', ');
        const myOnlineGenerals = onlineGenerals
            .filter((general) => general.nationId === me.nationId)
            .map((general) => general.name)
            .join(', ');
        const myVote = latestVote
            ? await ctx.db.vote.findFirst({
                  where: {
                      voteId: latestVote.id,
                      generalId: me.id,
                  },
                  select: { id: true },
              })
            : null;
        const worldMeta = asRecord(worldState.meta);
        const rawLastExecuted = worldMeta.lastTurnTime ?? worldMeta.turntime;
        const parsedLastExecuted =
            typeof rawLastExecuted === 'string' || rawLastExecuted instanceof Date ? new Date(rawLastExecuted) : null;

        return {
            onlineUserCount: onlineGenerals.length,
            onlineNations,
            onlineGenerals: myOnlineGenerals,
            nationNotice: ownNation ? resolveNationNotice(asRecord(ownNation.meta)) : '',
            lastExecuted:
                parsedLastExecuted && Number.isFinite(parsedLastExecuted.getTime())
                    ? parsedLastExecuted.toISOString()
                    : null,
            latestVote: latestVote
                ? {
                      id: latestVote.id,
                      title: latestVote.title,
                      hasVoted: Boolean(myVote),
                  }
                : null,
        };
    }),
});
