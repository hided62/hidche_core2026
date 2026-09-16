import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { asRecord, canReadPlayAudit } from '@sammo-ts/common';
import type { GamePrisma } from '@sammo-ts/infra';
import type { GameApiContext } from '../../context.js';
import { readOnlyAuthedProcedure } from '../../trpc.js';

export const auditProcedure = readOnlyAuthedProcedure.use(({ ctx, next }) => {
    if (
        !ctx.auth ||
        ctx.auth.profile !== ctx.profile.name ||
        !canReadPlayAudit(ctx.auth.user.roles, ctx.profile.name)
    ) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '이 프로필의 플레이 감사 권한이 필요합니다.' });
    }
    return next();
});

export const zAuditMonth = z
    .object({
        year: z.number().int().min(0).max(9999),
        month: z.number().int().min(1).max(12),
        kind: z.enum(['MONTH_END', 'FINAL']).default('MONTH_END'),
    })
    .strict();
export const zAuditPage = z
    .object({
        at: zAuditMonth.optional(),
        nationId: z.number().int().nonnegative().optional(),
        cursor: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(200).default(50),
    })
    .strict();
export const monthOrdinal = (year: number, month: number): number => year * 12 + month - 1;

export const readAudit = async <T>(
    ctx: GameApiContext,
    read: (tx: GamePrisma.TransactionClient) => Promise<T>
): Promise<T> => {
    if (!ctx.db.$transaction)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '감사 조회 transaction을 사용할 수 없습니다.' });
    try {
        return await ctx.db.$transaction(read, { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 5000 });
    } catch (error) {
        if (error instanceof TRPCError) throw error;
        if (error && typeof error === 'object' && 'code' in error && ['P2028', 'P2034'].includes(String(error.code))) {
            throw new TRPCError({ code: 'TIMEOUT', message: '조회가 지연되었습니다. 기간을 줄여 다시 조회해 주세요.' });
        }
        throw error;
    }
};

export const readAuditWorld = async (tx: GamePrisma.TransactionClient) => {
    const world = await tx.worldState.findFirst({
        orderBy: { id: 'asc' },
        select: {
            currentYear: true,
            currentMonth: true,
            lastTurnTick: true,
            meta: true,
            config: true,
        },
    });
    if (!world) throw new TRPCError({ code: 'NOT_FOUND', message: '게임 상태가 없습니다.' });
    const meta = asRecord(world.meta);
    const serverId = typeof meta.serverId === 'string' && meta.serverId.trim() ? meta.serverId : null;
    const scenario = asRecord(meta.scenarioMeta);
    const config = asRecord(world.config);
    const startYear =
        typeof scenario.startYear === 'number'
            ? scenario.startYear
            : typeof asRecord(config.scenarioMeta).startYear === 'number'
              ? Number(asRecord(config.scenarioMeta).startYear)
              : world.currentYear;
    return {
        serverId,
        year: world.currentYear,
        month: world.currentMonth,
        startYear,
        tick: world.lastTurnTick?.toString() ?? null,
        asOf: new Date().toISOString(),
    };
};
export type AuditWorld = Awaited<ReturnType<typeof readAuditWorld>>;

export const findAuditMonth = async (
    tx: GamePrisma.TransactionClient,
    world: AuditWorld,
    at: z.infer<typeof zAuditMonth>
) => {
    const ordinal = monthOrdinal(at.year, at.month);
    if (at.year < world.startYear || ordinal > monthOrdinal(world.year, world.month)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '현재 기수의 게임 연월을 선택해 주세요.' });
    }
    if (!world.serverId) return null;
    return tx.playAuditMonth.findUnique({
        where: {
            serverId_year_month_kind: {
                serverId: world.serverId,
                year: at.year,
                month: at.month,
                kind: at.kind,
            },
        },
        select: {
            id: true,
            year: true,
            month: true,
            kind: true,
            tick: true,
            settlementsComplete: true,
            createdAt: true,
        },
    });
};

export const pageResult = <T>(
    rows: T[],
    limit: number,
    getId: (row: T) => number
): { items: T[]; nextCursor: number | null } => {
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? getId(items[items.length - 1]!) : null };
};
