import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord } from '@sammo-ts/common';
import { GamePrisma } from '@sammo-ts/infra';

import { authedProcedure, router } from '../../trpc.js';
import { getMyGeneral } from '../shared/general.js';
import { loadCurrentGameTime, type CurrentGameTime } from '../../services/gameClock.js';

const hasAdminRole = (roles: string[], profileName: string): boolean => {
    if (roles.includes('superuser') || roles.includes('admin') || roles.includes('admin.superuser')) {
        return true;
    }
    return roles.some(
        (role) =>
            role === 'admin.survey.open' ||
            role === 'admin.survey.open:*' ||
            role === `admin.survey.open:${profileName}`
    );
};

const adminProcedure = authedProcedure.use(({ ctx, next }) => {
    const roles = ctx.auth?.user.roles ?? [];
    if (!hasAdminRole(roles, ctx.profile.name)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin permission is required.' });
    }
    return next();
});

const resolveNumber = (source: Record<string, unknown>, keys: string[], fallback: number): number => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }
    return fallback;
};

const normalizeOptions = (options: string[]): string[] =>
    options.map((option) => option.trim()).filter((option) => option.length > 0);

const parseOptions = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string');
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                return parsed.filter((entry): entry is string => typeof entry === 'string');
            }
        } catch {
            return [];
        }
    }
    return [];
};

const parseSelection = (value: unknown): number[] => {
    if (Array.isArray(value)) {
        return value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                return parsed.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
            }
        } catch {
            return [];
        }
    }
    return [];
};

type VotePollRow = {
    id: number;
    title: string;
    body: string;
    options: unknown;
    multiple_options: number;
    reveal_mode: string;
    opener_general_id: number;
    opener_name: string;
    start_at: Date;
    end_at: Date | null;
    end_tick: bigint | null;
    closed_at: Date | null;
};

export const hasPollEnded = (
    poll: Pick<VotePollRow, 'closed_at' | 'end_at' | 'end_tick'>,
    time: CurrentGameTime
): boolean =>
    Boolean(poll.closed_at) ||
    (poll.end_tick !== null && time.tick !== null
        ? poll.end_tick < BigInt(time.tick)
        : Boolean(poll.end_at && poll.end_at.getTime() < time.now.getTime()));

const toGameTickOrNull = (time: CurrentGameTime, date: Date | null): bigint | null => {
    if (!date) return null;
    try {
        const tick = time.dateToTick(date);
        return tick === null ? null : BigInt(tick);
    } catch {
        return null;
    }
};

type VoteListRow = {
    id: number;
    title: string;
    start_at: Date;
    end_at: Date | null;
    closed_at: Date | null;
    reveal_mode: string;
    multiple_options: number;
    options_count: number;
};

type VoteCommentRow = {
    id: number;
    vote_id: number;
    general_id: number;
    nation_id: number;
    general_name: string;
    nation_name: string;
    text: string;
    created_at: Date;
};

type VoteResultRow = {
    selection: unknown;
    cnt: number | bigint;
};

const zRevealMode = z.enum(['after_vote', 'after_end']);

export const voteRouter = router({
    getVoteList: authedProcedure.query(async ({ ctx }) => {
        const worldState = await ctx.db.worldState.findFirst();
        const worldMeta = asRecord(worldState?.meta ?? {});
        const config = asRecord(worldState?.config ?? {});
        const constValues = asRecord(config.const);
        const develCost = resolveNumber(
            worldMeta,
            ['develcost', 'develCost'],
            resolveNumber(constValues, ['develCost', 'develcost', 'develrate'], 0)
        );
        const voteReward = develCost * 5;

        const rows = await ctx.db.$queryRaw<VoteListRow[]>(GamePrisma.sql`
            SELECT
                id,
                title,
                start_at,
                end_at,
                closed_at,
                reveal_mode,
                multiple_options,
                jsonb_array_length(options) AS options_count
            FROM vote_poll
            ORDER BY id DESC
        `);

        const polls = rows.map((row) => ({
            id: row.id,
            title: row.title,
            startAt: row.start_at.toISOString(),
            endAt: row.end_at ? row.end_at.toISOString() : null,
            closedAt: row.closed_at ? row.closed_at.toISOString() : null,
            revealMode: row.reveal_mode as 'after_vote' | 'after_end',
            optionsCount: Number(row.options_count ?? 0),
            multipleOptions: row.multiple_options,
        }));

        return { polls, voteReward };
    }),
    getVoteDetail: authedProcedure
        .input(z.object({ voteId: z.number().int().positive() }))
        .query(async ({ ctx, input }) => {
            const rows = await ctx.db.$queryRaw<VotePollRow[]>(GamePrisma.sql`
                SELECT
                    id,
                    title,
                    body,
                    options,
                    multiple_options,
                    reveal_mode,
                    opener_general_id,
                    opener_name,
                    start_at,
                    end_at,
                    end_tick,
                    closed_at
                FROM vote_poll
                WHERE id = ${input.voteId}
                LIMIT 1
            `);
            const row = rows[0];
            if (!row) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '설문조사가 없습니다.' });
            }

            const options = parseOptions(row.options);
            const gameTime = await loadCurrentGameTime(ctx.db);
            const pollEnded = hasPollEnded(row, gameTime);

            const userId = ctx.auth?.user.id;
            const general = userId ? await ctx.db.general.findFirst({ where: { userId }, select: { id: true } }) : null;

            const [comments, userCnt, myVoteRow] = await Promise.all([
                ctx.db.$queryRaw<VoteCommentRow[]>(GamePrisma.sql`
                    SELECT
                        id,
                        vote_id,
                        general_id,
                        nation_id,
                        general_name,
                        nation_name,
                        text,
                        created_at
                    FROM vote_comment
                    WHERE vote_id = ${input.voteId}
                    ORDER BY created_at ASC
                `),
                ctx.db.general.count({ where: { npcState: { lt: 2 } } }),
                general
                    ? ctx.db.$queryRaw<Array<{ selection: unknown }>>(GamePrisma.sql`
                          SELECT selection
                          FROM vote
                          WHERE vote_id = ${input.voteId} AND general_id = ${general.id}
                          LIMIT 1
                      `)
                    : Promise.resolve([]),
            ]);

            const myVote = myVoteRow[0]?.selection ? parseSelection(myVoteRow[0].selection) : null;

            // 레거시는 투표 전에도 현재 집계를 보여준다. after_end만 명시적으로 숨긴다.
            const canReveal = row.reveal_mode === 'after_end' ? pollEnded : true;

            const voteResults = canReveal
                ? await ctx.db.$queryRaw<VoteResultRow[]>(GamePrisma.sql`
                      SELECT selection, count(*) as cnt
                      FROM vote
                      WHERE vote_id = ${input.voteId}
                      GROUP BY selection
                  `)
                : [];

            const votes = voteResults.map((entry) => ({
                selection: parseSelection(entry.selection),
                count: Number(entry.cnt),
            }));

            return {
                voteInfo: {
                    id: row.id,
                    title: row.title,
                    body: row.body,
                    options,
                    multipleOptions: row.multiple_options,
                    revealMode: row.reveal_mode as 'after_vote' | 'after_end',
                    openerGeneralId: row.opener_general_id,
                    openerName: row.opener_name,
                    startAt: row.start_at.toISOString(),
                    endAt: row.end_at ? row.end_at.toISOString() : null,
                    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
                },
                votes,
                comments: comments.map((comment) => ({
                    id: comment.id,
                    voteId: comment.vote_id,
                    generalId: comment.general_id,
                    nationId: comment.nation_id,
                    generalName: comment.general_name,
                    nationName: comment.nation_name,
                    text: comment.text,
                    createdAt: comment.created_at.toISOString(),
                })),
                myVote,
                userCnt,
            };
        }),
    submitVote: authedProcedure
        .input(
            z.object({
                voteId: z.number().int().positive(),
                selection: z.array(z.number().int()),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const selection = input.selection;
            if (!selection || selection.length === 0) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '선택한 항목이 없습니다.' });
            }

            const pollRows = await ctx.db.$queryRaw<VotePollRow[]>(GamePrisma.sql`
                SELECT
                    id,
                    title,
                    body,
                    options,
                    multiple_options,
                    reveal_mode,
                    opener_general_id,
                    opener_name,
                    start_at,
                    end_at,
                    end_tick,
                    closed_at
                FROM vote_poll
                WHERE id = ${input.voteId}
                LIMIT 1
            `);
            const poll = pollRows[0];
            if (!poll) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '설문조사가 없습니다.' });
            }
            const gameTime = await loadCurrentGameTime(ctx.db);
            if (hasPollEnded(poll, gameTime)) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '설문조사가 종료되었습니다.' });
            }

            const options = parseOptions(poll.options);
            if (poll.multiple_options >= 1 && selection.length > poll.multiple_options) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '선택한 항목이 너무 많습니다.' });
            }

            const optionCount = options.length;
            for (const value of selection) {
                if (!Number.isFinite(value) || value < 0 || value >= optionCount) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: '선택한 항목이 없습니다.' });
                }
            }

            const sortedSelection = [...selection].sort((a, b) => a - b);
            if (new Set(sortedSelection).size !== sortedSelection.length) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '선택한 항목이 올바르지 않습니다.' });
            }
            const general = await getMyGeneral(ctx);

            const rewardResult = await ctx.turnDaemon.requestCommand({
                type: 'voteReward',
                voteId: input.voteId,
                generalId: general.id,
                selection: sortedSelection,
                ...(gameTime.tick === null ? {} : { acceptedGameTick: gameTime.tick }),
            });

            if (!rewardResult || rewardResult.type !== 'voteReward') {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
            }
            if (!rewardResult.ok) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: rewardResult.reason });
            }

            ctx.changeJournal?.mark('front.general', general.id);
            return { ok: true, wonLottery: rewardResult.awardedUnique };
        }),
    addComment: authedProcedure
        .input(
            z.object({
                voteId: z.number().int().positive(),
                text: z.string().trim().max(200),
            })
        )
        .mutation(async ({ ctx, input }) => {
            if (!input.text) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '내용이 필요합니다.' });
            }

            const pollRows = await ctx.db.$queryRaw<Array<{ id: number }>>(GamePrisma.sql`
                SELECT id
                FROM vote_poll
                WHERE id = ${input.voteId}
                LIMIT 1
            `);
            if (!pollRows[0]?.id) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '설문조사가 없습니다.' });
            }

            const general = await getMyGeneral(ctx);
            const nation = general.nationId
                ? await ctx.db.nation.findFirst({ where: { id: general.nationId }, select: { name: true } })
                : null;
            const nationName = nation?.name ?? '재야';

            await ctx.db.$queryRaw(GamePrisma.sql`
                INSERT INTO vote_comment (vote_id, general_id, nation_id, general_name, nation_name, text)
                VALUES (${input.voteId}, ${general.id}, ${general.nationId}, ${general.name}, ${nationName}, ${input.text})
            `);

            return { ok: true };
        }),
    createPoll: adminProcedure
        .input(
            z.object({
                title: z.string().trim().min(1).max(200),
                body: z.string().trim().max(5000).optional().default(''),
                options: z.array(z.string()).default([]),
                multipleOptions: z.number().int().optional().default(1),
                endAt: z.string().optional(),
                revealMode: zRevealMode,
                closePrevious: z.boolean().optional().default(true),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const general = await getMyGeneral(ctx);
            const options = normalizeOptions(input.options);
            if (options.length === 0) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '항목이 없습니다.' });
            }

            const endAt = input.endAt ? new Date(input.endAt) : null;
            if (endAt && Number.isNaN(endAt.getTime())) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '종료일이 잘못되었습니다.' });
            }
            const gameTime = await loadCurrentGameTime(ctx.db);
            if (endAt && endAt < gameTime.now) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '종료일이 이미 지났습니다.' });
            }

            let multipleOptions = input.multipleOptions;
            if (multipleOptions < 0) {
                multipleOptions = 0;
            }
            if (multipleOptions > options.length) {
                multipleOptions = options.length;
            }

            if (input.closePrevious) {
                await ctx.db.$queryRaw(GamePrisma.sql`
                    UPDATE vote_poll
                    SET closed_at = ${gameTime.now}, updated_at = NOW()
                    WHERE closed_at IS NULL
                `);
            }

            await ctx.db.$queryRaw(GamePrisma.sql`
                INSERT INTO vote_poll (
                    title,
                    body,
                    options,
                    multiple_options,
                    reveal_mode,
                    opener_general_id,
                    opener_name,
                    start_at,
                    start_tick,
                    end_at,
                    end_tick
                )
                VALUES (
                    ${input.title},
                    ${input.body ?? ''},
                    CAST(${JSON.stringify(options)} AS jsonb),
                    ${multipleOptions},
                    ${input.revealMode},
                    ${general.id},
                    ${general.name},
                    ${gameTime.now},
                    ${gameTime.tick === null ? null : BigInt(gameTime.tick)},
                    ${endAt},
                    ${toGameTickOrNull(gameTime, endAt)}
                )
            `);

            ctx.changeJournal?.mark('front.global');
            return { ok: true };
        }),
    updatePoll: adminProcedure
        .input(
            z.object({
                voteId: z.number().int().positive(),
                title: z.string().trim().min(1).max(200).optional(),
                body: z.string().trim().max(5000).optional(),
                appendOptions: z.array(z.string()).optional(),
                multipleOptions: z.number().int().optional(),
                endAt: z.string().optional(),
                revealMode: zRevealMode.optional(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const pollRows = await ctx.db.$queryRaw<VotePollRow[]>(GamePrisma.sql`
                SELECT
                    id,
                    title,
                    body,
                    options,
                    multiple_options,
                    reveal_mode,
                    opener_general_id,
                    opener_name,
                    start_at,
                    end_at,
                    end_tick,
                    closed_at
                FROM vote_poll
                WHERE id = ${input.voteId}
                LIMIT 1
            `);
            const poll = pollRows[0];
            if (!poll) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '설문조사가 없습니다.' });
            }

            const voteCountRow = await ctx.db.$queryRaw<Array<{ cnt: number }>>(GamePrisma.sql`
                SELECT count(*) as cnt
                FROM vote
                WHERE vote_id = ${input.voteId}
            `);
            const voteCount = Number(voteCountRow[0]?.cnt ?? 0);
            if (voteCount > 0) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 설문조사가 진행중입니다.' });
            }

            const existingOptions = parseOptions(poll.options);
            const appendedOptions = normalizeOptions(input.appendOptions ?? []);
            const nextOptions = appendedOptions.length > 0 ? [...existingOptions, ...appendedOptions] : existingOptions;

            let nextMultipleOptions = input.multipleOptions;
            if (nextMultipleOptions !== undefined) {
                if (nextMultipleOptions < 0) {
                    nextMultipleOptions = 0;
                }
                if (nextMultipleOptions > nextOptions.length) {
                    nextMultipleOptions = nextOptions.length;
                }
            }

            const endAt = input.endAt ? new Date(input.endAt) : undefined;
            if (endAt && Number.isNaN(endAt.getTime())) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '종료일이 잘못되었습니다.' });
            }
            const gameTime = await loadCurrentGameTime(ctx.db);
            if (endAt && endAt < gameTime.now) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '종료일이 이미 지났습니다.' });
            }

            if (
                input.title === undefined &&
                input.body === undefined &&
                appendedOptions.length === 0 &&
                nextMultipleOptions === undefined &&
                endAt === undefined &&
                input.revealMode === undefined
            ) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '변경할 항목이 없습니다.' });
            }

            await ctx.db.$queryRaw(GamePrisma.sql`
                UPDATE vote_poll
                SET
                    title = COALESCE(${input.title}, title),
                    body = COALESCE(${input.body}, body),
                    options = ${appendedOptions.length > 0 ? GamePrisma.sql`CAST(${JSON.stringify(nextOptions)} AS jsonb)` : GamePrisma.sql`options`},
                    multiple_options = COALESCE(${nextMultipleOptions}, multiple_options),
                    reveal_mode = COALESCE(${input.revealMode}, reveal_mode),
                    end_at = ${endAt ?? poll.end_at},
                    end_tick = ${endAt ? toGameTickOrNull(gameTime, endAt) : poll.end_tick},
                    updated_at = NOW()
                WHERE id = ${input.voteId}
            `);

            if (input.title !== undefined || endAt !== undefined) {
                ctx.changeJournal?.mark('front.global');
            }
            return { ok: true };
        }),
    closePoll: adminProcedure
        .input(z.object({ voteId: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
            const rows = await ctx.db.$queryRaw<Array<{ id: number }>>(GamePrisma.sql`
                UPDATE vote_poll
                SET closed_at = ${(await loadCurrentGameTime(ctx.db)).now}, updated_at = NOW()
                WHERE id = ${input.voteId}
                RETURNING id
            `);
            if (!rows[0]?.id) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '설문조사가 없습니다.' });
            }
            ctx.changeJournal?.mark('front.global');
            return { ok: true };
        }),
    getAdminStatus: adminProcedure.query(async () => ({ ok: true })),
});
