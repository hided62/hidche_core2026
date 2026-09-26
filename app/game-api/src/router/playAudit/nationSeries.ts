import { GamePrisma } from '@sammo-ts/infra';
import { asRecord } from '@sammo-ts/common';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { auditProcedure, monthOrdinal, readAudit, readAuditWorld, zAuditMonth } from './shared.js';

const zDex = z.object({ dex1: z.number(), dex2: z.number(), dex3: z.number(), dex4: z.number(), dex5: z.number() });
const zPopulation = z.object({
    count: z.number().int().nonnegative(),
    crew: z.number().nonnegative().nullable().default(null),
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

/** 같은 transaction에서 commit된 당월 정산만 반환한다. 미관측을 0으로 만들지 않는다. */
export const projectCurrentSettlement = (meta: unknown, year: number, month: number, nationId: number) => {
    const flows = asRecord(asRecord(meta).playAuditFlows);
    const matches = flows.year === year && flows.month === month;
    const entries = asRecord(flows.entries);
    const resource = (key: 'gold' | 'rice') => {
        const row = asRecord(entries[`${nationId}:${key}`]);
        if (
            !matches ||
            row.nationId !== nationId ||
            row.resource !== key ||
            typeof row.income !== 'number' ||
            !Number.isFinite(row.income) ||
            typeof row.paid !== 'number' ||
            !Number.isFinite(row.paid)
        )
            return null;
        return { income: row.income, paid: row.paid };
    };
    return {
        year,
        month,
        gold: resource('gold'),
        rice: resource('rice'),
        complete: matches && flows.complete === true,
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
                : Math.max(monthOrdinal(world.startYear, world.startMonth), current - 5);
            const to = input.to ? monthOrdinal(input.to.year, input.to.month) : current;
            if (from < monthOrdinal(world.startYear, world.startMonth) || to > current || from > to) {
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
            // 기존 집계는 같은 월의 장수 표본을 DB에서 합산한다. 원문은 전송하지 않는다.
            const legacySamples = [...dataBySample]
                .filter(([, nation]) => Object.values(nation.populations).some((group) => group.crew === null))
                .map(([id]) => id);
            if (legacySamples.length) {
                const troops = await tx.$queryRaw<
                    { sampleId: string; population: 'human' | 'npc' | 'troopNpc'; count: number; crew: number | null }[]
                >(GamePrisma.sql`
                    SELECT sample_id AS "sampleId",
                        CASE WHEN npc_state = 5 THEN 'troopNpc' WHEN npc_state < 2 THEN 'human' ELSE 'npc' END AS population,
                        count(*)::int AS count,
                        CASE WHEN bool_and(jsonb_typeof(data->'crew') = 'number' AND data->'crew' IS NOT NULL)
                            THEN sum(CASE WHEN jsonb_typeof(data->'crew') = 'number' THEN (data->>'crew')::double precision END) ELSE NULL END AS crew
                    FROM play_audit_general
                    WHERE nation_id = ${input.nationId} AND sample_id IN (${GamePrisma.join(legacySamples)})
                    GROUP BY sample_id, population
                `);
                for (const sampleId of legacySamples) {
                    const nation = dataBySample.get(sampleId)!;
                    for (const key of ['human', 'npc', 'troopNpc'] as const) {
                        const group = nation.populations[key];
                        if (group.crew !== null) continue;
                        const row = troops.find((item) => item.sampleId === sampleId && item.population === key);
                        // 저장 인원수와 원본 표본 수가 같을 때만 확정한다.
                        if (group.count === 0 && !row) group.crew = 0;
                        else if (row?.count === group.count) group.crew = row.crew;
                    }
                }
            }
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
            const currentState =
                world.serverId && end === current
                    ? await tx.worldState.findFirst({ orderBy: { id: 'asc' }, select: { meta: true } })
                    : null;
            return {
                ...world,
                items,
                currentSettlement: currentState
                    ? projectCurrentSettlement(currentState.meta, world.year, world.month, input.nationId)
                    : null,
                nextCursor: end < to ? dateOf(start + input.limit * width) : null,
            };
        })
    );
