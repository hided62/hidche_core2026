import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { auditProcedure, monthOrdinal, readAudit, readAuditWorld, zAuditMonth } from './shared.js';

const zDex = z.object({ dex1: z.number(), dex2: z.number(), dex3: z.number(), dex4: z.number(), dex5: z.number() });
const zPopulation = z.object({
    count: z.number().int().nonnegative(),
    gold: z.number(),
    rice: z.number(),
    dex: zDex,
    averageGold: z.number().nullable(),
    averageRice: z.number().nullable(),
    averageDex: z.object({
        dex1: z.number().nullable(),
        dex2: z.number().nullable(),
        dex3: z.number().nullable(),
        dex4: z.number().nullable(),
        dex5: z.number().nullable(),
    }),
});
export const zAuditNation = z.object({
    id: z.number(),
    name: z.string(),
    color: z.string(),
    gold: z.number(),
    rice: z.number(),
    tech: z.number(),
    appliedRate: z.number(),
    incomeGold: z.number().nullable(),
    incomeRice: z.number().nullable(),
    paidGold: z.number().nullable(),
    paidRice: z.number().nullable(),
    populations: z.object({ human: zPopulation, npc: zPopulation, troopNpc: zPopulation }),
});
export type AuditNationData = z.infer<typeof zAuditNation>;
export interface NationMonthPoint {
    ordinal: number;
    collected: boolean;
    settlementsComplete: boolean;
    data: AuditNationData | null;
}
const dateOf = (ordinal: number): { year: number; month: number } => ({
    year: Math.floor(ordinal / 12),
    month: (ordinal % 12) + 1,
});
const flowKeys = ['incomeGold', 'incomeRice', 'paidGold', 'paidRice'] as const;

export const summarizeNationPeriod = (start: number, width: number, months: NationMonthPoint[]) => {
    let latest: NationMonthPoint | undefined;
    for (const point of months) if (point.data !== null) latest = point;
    const complete = months.length === width && months.every((point) => point.collected && point.data !== null);
    const flows: Record<(typeof flowKeys)[number], number | null> = {
        incomeGold: null,
        incomeRice: null,
        paidGold: null,
        paidRice: null,
    };
    for (const key of flowKeys) {
        if (
            months.length > 0 &&
            months.every((point) => point.collected && point.settlementsComplete && point.data?.[key] != null)
        ) {
            flows[key] = months.reduce((sum, point) => sum + point.data![key]!, 0);
        }
    }
    return {
        ...dateOf(start),
        periodMonths: width,
        complete,
        from: months.length ? dateOf(months[0]!.ordinal) : null,
        to: months.length ? dateOf(months[months.length - 1]!.ordinal) : null,
        stockAsOf: latest ? dateOf(latest.ordinal) : null,
        stock: latest?.data
            ? {
                  id: latest.data.id,
                  name: latest.data.name,
                  color: latest.data.color,
                  gold: latest.data.gold,
                  rice: latest.data.rice,
                  tech: latest.data.tech,
                  appliedRate: latest.data.appliedRate,
                  populations: latest.data.populations,
              }
            : null,
        flows,
        months: months.map((point) => ({
            ...dateOf(point.ordinal),
            collected: point.collected,
            nationPresent: point.data !== null,
            settlementsComplete: point.settlementsComplete,
        })),
    };
};

const zCalendarMonth = zAuditMonth.omit({ kind: true });
export const nationSeries = auditProcedure
    .input(
        z
            .object({
                nationId: z.number().int().nonnegative(),
                from: zCalendarMonth.optional(),
                to: zCalendarMonth.optional(),
                resolution: z.enum(['month', 'halfYear']).default('halfYear'),
                cursor: zCalendarMonth.optional(),
                limit: z.number().int().min(1).max(200).default(50),
            })
            .strict()
    )
    .query(({ ctx, input }) =>
        readAudit(ctx, async (tx) => {
            const world = await readAuditWorld(tx);
            const current = monthOrdinal(world.year, world.month);
            const from = input.from
                ? monthOrdinal(input.from.year, input.from.month)
                : Math.max(world.startYear * 12, current - 5);
            const to = input.to ? monthOrdinal(input.to.year, input.to.month) : current;
            if (from < world.startYear * 12 || to > current || from > to) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '현재 기수 안에서 시작·종료 월을 선택해 주세요.' });
            }
            const width = input.resolution === 'month' ? 1 : 6;
            const first = Math.floor(from / width) * width;
            const start = input.cursor ? monthOrdinal(input.cursor.year, input.cursor.month) : first;
            if (start < first || start > to || start % width !== 0) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '조회 기간에 맞는 다음 페이지를 선택해 주세요.' });
            }
            const end = Math.min(to, start + input.limit * width - 1);
            const low = dateOf(Math.max(from, start));
            const high = dateOf(end);
            const samples = world.serverId
                ? await tx.playAuditMonth.findMany({
                      where: {
                          serverId: world.serverId,
                          kind: 'MONTH_END',
                          AND: [
                              { OR: [{ year: { gt: low.year } }, { year: low.year, month: { gte: low.month } }] },
                              { OR: [{ year: { lt: high.year } }, { year: high.year, month: { lte: high.month } }] },
                          ],
                      },
                      select: { id: true, year: true, month: true, settlementsComplete: true },
                      orderBy: [{ year: 'asc' }, { month: 'asc' }],
                      take: input.limit * width,
                  })
                : [];
            const nations = samples.length
                ? await tx.playAuditNation.findMany({
                      where: {
                          sampleId: { in: samples.map((sample) => sample.id) },
                          nationId: input.nationId,
                      },
                      select: { sampleId: true, data: true },
                  })
                : [];
            const dataBySample = new Map(nations.map((row) => [row.sampleId, zAuditNation.parse(row.data)]));
            const sampleByMonth = new Map(samples.map((sample) => [monthOrdinal(sample.year, sample.month), sample]));
            const items: ReturnType<typeof summarizeNationPeriod>[] = [];
            for (let period = start; period <= end; period += width) {
                const months: NationMonthPoint[] = [];
                for (let ordinal = Math.max(from, period); ordinal <= Math.min(end, period + width - 1); ordinal++) {
                    const sample = sampleByMonth.get(ordinal);
                    months.push({
                        ordinal,
                        collected: Boolean(sample),
                        settlementsComplete: sample?.settlementsComplete ?? false,
                        data: sample ? (dataBySample.get(sample.id) ?? null) : null,
                    });
                }
                items.push(summarizeNationPeriod(period, width, months));
            }
            return { ...world, items, nextCursor: end < to ? dateOf(start + input.limit * width) : null };
        })
    );
