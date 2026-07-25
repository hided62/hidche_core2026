import { TRPCError } from '@trpc/server';
import { GamePrisma } from '@sammo-ts/infra';
import { z } from 'zod';

import { authedProcedure, router } from '../../trpc.js';
import { appendInheritanceLog, readInheritancePoint, setInheritancePoint } from '../../services/inheritance.js';
import { getMyGeneral } from '../shared/general.js';

const joinYearMonth = (year: number, month: number): number => year * 12 + month - 1;

const purifySelection = (selection: readonly number[]): number[] =>
    [...new Set(selection)].sort((left, right) => left - right);

const requireUserId = (auth: { user: { id: string } } | null): string => {
    const userId = auth?.user.id;
    if (!userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return userId;
};

const loadWorldDate = async (db: Parameters<typeof getMyGeneral>[0]['db']) => {
    const world = await db.worldState.findFirst({
        select: { currentYear: true, currentMonth: true },
    });
    if (!world) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'World state not found.' });
    }
    return world;
};

export const bettingRouter = router({
    getList: authedProcedure
        .input(z.object({ req: z.enum(['bettingNation', 'tournament']).optional() }).optional())
        .query(async ({ ctx, input }) => {
            requireUserId(ctx.auth);
            await getMyGeneral(ctx);
            const [world, rows] = await Promise.all([
                loadWorldDate(ctx.db),
                ctx.db.nationBetting.findMany({
                    where: input?.req ? { type: input.req } : undefined,
                    orderBy: { id: 'asc' },
                    include: { bets: { select: { amount: true } } },
                }),
            ]);
            const bettingList = Object.fromEntries(
                rows.map((row) => [
                    row.id,
                    {
                        id: row.id,
                        type: row.type,
                        name: row.name,
                        finished: row.finished,
                        selectCnt: row.selectCount,
                        isExclusive: row.isExclusive,
                        reqInheritancePoint: row.requiresInheritancePoint,
                        openYearMonth: row.openYearMonth,
                        closeYearMonth: row.closeYearMonth,
                        winner: row.winner,
                        totalAmount: row.bets.reduce((sum, bet) => sum + bet.amount, 0),
                    },
                ])
            );
            return {
                result: true,
                bettingList,
                year: world.currentYear,
                month: world.currentMonth,
            };
        }),

    getDetail: authedProcedure
        .input(z.object({ bettingId: z.number().int().positive() }))
        .query(async ({ ctx, input }) => {
            const userId = requireUserId(ctx.auth);
            const general = await getMyGeneral(ctx);
            const [world, betting, remainPoint] = await Promise.all([
                loadWorldDate(ctx.db),
                ctx.db.nationBetting.findUnique({
                    where: { id: input.bettingId },
                    include: { bets: { orderBy: { id: 'asc' } } },
                }),
                ctx.db.inheritancePoint.findUnique({
                    where: { userId_key: { userId, key: 'previous' } },
                    select: { value: true },
                }),
            ]);
            if (!betting) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '해당 베팅이 없습니다' });
            }
            const group = (bets: typeof betting.bets) => {
                const totals = new Map<string, number>();
                for (const bet of bets) {
                    totals.set(bet.selectionKey, (totals.get(bet.selectionKey) ?? 0) + bet.amount);
                }
                return Array.from(totals, ([selection, amount]) => [selection, amount] as const);
            };
            return {
                result: true,
                bettingInfo: {
                    id: betting.id,
                    type: betting.type,
                    name: betting.name,
                    finished: betting.finished,
                    selectCnt: betting.selectCount,
                    isExclusive: betting.isExclusive,
                    reqInheritancePoint: betting.requiresInheritancePoint,
                    openYearMonth: betting.openYearMonth,
                    closeYearMonth: betting.closeYearMonth,
                    candidates: betting.candidates,
                    winner: betting.winner,
                },
                bettingDetail: group(betting.bets),
                myBetting: group(betting.bets.filter((bet) => bet.userId === userId)),
                remainPoint: betting.requiresInheritancePoint ? (remainPoint?.value ?? 0) : general.gold,
                year: world.currentYear,
                month: world.currentMonth,
            };
        }),

    bet: authedProcedure
        .input(
            z.object({
                bettingId: z.number().int().positive(),
                bettingType: z.array(z.number().int().nonnegative()),
                amount: z.number().int().min(10),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const userId = requireUserId(ctx.auth);
            const general = await getMyGeneral(ctx);
            await ctx.db.$queryRaw`
                SELECT id
                FROM nation_betting
                WHERE id = ${input.bettingId}
                FOR UPDATE
            `;
            const betting = await ctx.db.nationBetting.findUnique({ where: { id: input.bettingId } });
            if (!betting) {
                throw new TRPCError({ code: 'NOT_FOUND', message: `해당 베팅이 없습니다: ${input.bettingId}` });
            }
            if (betting.finished) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 종료된 베팅입니다' });
            }
            const world = await loadWorldDate(ctx.db);
            const yearMonth = joinYearMonth(world.currentYear, world.currentMonth);
            if (betting.closeYearMonth <= yearMonth) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 마감된 베팅입니다' });
            }
            if (betting.openYearMonth > yearMonth) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '아직 시작되지 않은 베팅입니다' });
            }

            const selection = purifySelection(input.bettingType);
            if (selection.length !== betting.selectCount || input.bettingType.length !== betting.selectCount) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '필요한 선택 수를 채우지 못했습니다.' });
            }
            const candidates = Array.isArray(betting.candidates) ? betting.candidates : [];
            if (selection.some((index) => index >= candidates.length)) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '올바른 후보가 아닙니다.' });
            }
            const selectionKey = JSON.stringify(selection);
            const totals = await ctx.db.$queryRaw<Array<{ total: number | null }>>(
                GamePrisma.sql`
                    SELECT SUM(amount)::float8 AS total
                    FROM nation_bet
                    WHERE betting_id = ${input.bettingId}
                        AND user_id = ${userId}
                `
            );
            const previousBetAmount = totals[0]?.total ?? 0;
            if (previousBetAmount + input.amount > 1_000) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: `${1_000 - previousBetAmount}${betting.requiresInheritancePoint ? '유산포인트' : '금'}까지만 베팅 가능합니다.`,
                });
            }

            if (betting.requiresInheritancePoint) {
                const remainingPoint = await readInheritancePoint(ctx.db, userId, 'previous');
                if (remainingPoint < input.amount) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: '유산포인트가 충분하지 않습니다.' });
                }
                await setInheritancePoint(ctx.db, userId, 'previous', remainingPoint - input.amount);
                await appendInheritanceLog(
                    ctx.db,
                    userId,
                    world.currentYear,
                    world.currentMonth,
                    `${input.amount} 포인트를 베팅에 사용`
                );
                await ctx.db.rankData.upsert({
                    where: {
                        generalId_type: {
                            generalId: general.id,
                            type: 'inherit_spent_dyn',
                        },
                    },
                    update: { value: { increment: input.amount } },
                    create: {
                        generalId: general.id,
                        nationId: general.nationId,
                        type: 'inherit_spent_dyn',
                        value: input.amount,
                    },
                });
            } else {
                throw new TRPCError({
                    code: 'NOT_IMPLEMENTED',
                    message: 'Nation betting currently requires inheritance points.',
                });
            }

            await ctx.db.nationBet.upsert({
                where: {
                    bettingId_userId_selectionKey: {
                        bettingId: input.bettingId,
                        userId,
                        selectionKey,
                    },
                },
                update: { amount: { increment: input.amount }, generalId: general.id, selection },
                create: {
                    bettingId: input.bettingId,
                    generalId: general.id,
                    userId,
                    selection,
                    selectionKey,
                    amount: input.amount,
                },
            });
            return { result: true };
        }),
});
