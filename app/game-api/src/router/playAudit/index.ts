import { nationSeries, zAuditNation } from './nationSeries.js';
import { cityDetail, generalDetail, generalTurns } from './details.js';
import { generalLogs } from './logs.js';
import { policyHistory, policyVersion } from './policies.js';
import { z } from 'zod';
import { canReadPlayAuditAccounts } from '@sammo-ts/common';
import { router } from '../../trpc.js';
import {
    auditProcedure,
    findAuditMonth,
    pageResult,
    readAudit,
    readAuditWorld,
    zAuditPage,
    zAuditMonth,
} from './shared.js';
import {
    citySelect,
    generalSelect,
    projectCurrentCity,
    projectCurrentGeneral,
    zAuditCityData,
    zAuditGeneralData,
} from './projection.js';

export const playAuditRouter = router({
    policyHistory,
    policyVersion,
    generalLogs,
    cityDetail,
    generalDetail,
    generalTurns,
    nationSeries,
    nationSnapshot: auditProcedure
        .input(z.object({ nationId: z.number().int().nonnegative(), at: zAuditMonth }).strict())
        .query(({ ctx, input }) =>
            readAudit(ctx, async (tx) => {
                const world = await readAuditWorld(tx);
                const sample = await findAuditMonth(tx, world, input.at);
                const row = sample
                    ? await tx.playAuditNation.findUnique({
                          where: { sampleId_nationId: { sampleId: sample.id, nationId: input.nationId } },
                          select: { data: true },
                      })
                    : null;
                return {
                    ...world,
                    sample,
                    collected: Boolean(sample),
                    nation: row ? zAuditNation.parse(row.data) : null,
                };
            })
        ),
    nations: auditProcedure.input(zAuditPage.omit({ nationId: true })).query(({ ctx, input }) =>
        readAudit(ctx, async (tx) => {
            const world = await readAuditWorld(tx);
            const identity = z.object({ id: z.number(), name: z.string(), color: z.string() });
            if (input.at) {
                const sample = await findAuditMonth(tx, world, input.at);
                const rows = sample
                    ? await tx.playAuditNation.findMany({
                          where: {
                              sampleId: sample.id,
                              nationId: input.cursor === undefined ? undefined : { gt: input.cursor },
                          },
                          orderBy: { nationId: 'asc' },
                          take: input.limit + 1,
                          select: { data: true },
                      })
                    : [];
                return {
                    ...world,
                    collected: Boolean(sample),
                    ...pageResult(
                        rows.map((row) => identity.parse(row.data)),
                        input.limit,
                        (row) => row.id
                    ),
                };
            }
            const rows = await tx.nation.findMany({
                where: { id: input.cursor === undefined ? undefined : { gt: input.cursor } },
                orderBy: { id: 'asc' },
                take: input.limit + 1,
                select: { id: true, name: true, color: true },
            });
            return { ...world, collected: true, ...pageResult(rows, input.limit, (row) => row.id) };
        })
    ),
    capabilities: auditProcedure.query(({ ctx }) => ({
        profileName: ctx.profile.name,
        read: true,
        accounts: canReadPlayAuditAccounts(ctx.auth!.user.roles, ctx.profile.name),
    })),
    coverage: auditProcedure
        .input(
            z
                .object({ cursor: zAuditMonth.optional(), limit: z.number().int().min(1).max(200).default(50) })
                .strict()
                .default({ limit: 50 })
        )
        .query(({ ctx, input }) =>
            readAudit(ctx, async (tx) => {
                const world = await readAuditWorld(tx);
                const samples = world.serverId
                    ? await tx.playAuditMonth.findMany({
                          where: {
                              serverId: world.serverId,
                              ...(input.cursor
                                  ? {
                                        OR: [
                                            { year: { gt: input.cursor.year } },
                                            { year: input.cursor.year, month: { gt: input.cursor.month } },
                                            {
                                                year: input.cursor.year,
                                                month: input.cursor.month,
                                                kind: { gt: input.cursor.kind },
                                            },
                                        ],
                                    }
                                  : {}),
                          },
                          take: input.limit + 1,
                          orderBy: [{ year: 'asc' }, { month: 'asc' }, { kind: 'asc' }],
                          select: { year: true, month: true, kind: true, settlementsComplete: true, createdAt: true },
                      })
                    : [];
                return {
                    ...world,
                    status: !world.serverId
                        ? ('IDENTITY_MISSING' as const)
                        : samples.length
                          ? ('COLLECTED' as const)
                          : input.cursor
                            ? ('PAGE_EMPTY' as const)
                            : ('NOT_COLLECTED' as const),
                    samples: samples.slice(0, input.limit),
                    nextCursor:
                        samples.length > input.limit
                            ? {
                                  year: samples[input.limit - 1]!.year,
                                  month: samples[input.limit - 1]!.month,
                                  kind: z.enum(['MONTH_END', 'FINAL', 'INITIAL']).parse(samples[input.limit - 1]!.kind),
                              }
                            : null,
                };
            })
        ),
    generals: auditProcedure
        .input(
            zAuditPage.extend({
                cityId: z.number().int().nonnegative().optional(),
                population: z.enum(['human', 'npc', 'troopNpc']).optional(),
            })
        )
        .query(({ ctx, input }) =>
            readAudit(ctx, async (tx) => {
                const world = await readAuditWorld(tx);
                const npcState =
                    input.population === 'human'
                        ? { lt: 2 }
                        : input.population === 'npc'
                          ? { gte: 2, not: 5 }
                          : input.population === 'troopNpc'
                            ? 5
                            : undefined;
                const filter = { nationId: input.nationId, cityId: input.cityId, npcState };
                if (input.at) {
                    const sample = await findAuditMonth(tx, world, input.at);
                    const rows = sample
                        ? await tx.playAuditGeneral.findMany({
                              where: {
                                  sampleId: sample.id,
                                  ...filter,
                                  generalId: input.cursor === undefined ? undefined : { gt: input.cursor },
                              },
                              orderBy: { generalId: 'asc' },
                              take: input.limit + 1,
                              select: { data: true },
                          })
                        : [];
                    return {
                        ...world,
                        sample,
                        collected: Boolean(sample),
                        ...pageResult(
                            rows.map((row) => zAuditGeneralData.parse(row.data)),
                            input.limit,
                            (row) => row.id
                        ),
                    };
                }
                const rows = await tx.general.findMany({
                    where: { ...filter, id: input.cursor === undefined ? undefined : { gt: input.cursor } },
                    orderBy: { id: 'asc' },
                    take: input.limit + 1,
                    select: generalSelect,
                });
                return {
                    ...world,
                    sample: null,
                    collected: true,
                    ...pageResult(rows.map(projectCurrentGeneral), input.limit, (row) => row.id),
                };
            })
        ),
    cities: auditProcedure.input(zAuditPage).query(({ ctx, input }) =>
        readAudit(ctx, async (tx) => {
            const world = await readAuditWorld(tx);
            if (input.at) {
                const sample = await findAuditMonth(tx, world, input.at);
                const rows = sample
                    ? await tx.playAuditCity.findMany({
                          where: {
                              sampleId: sample.id,
                              nationId: input.nationId,
                              cityId: input.cursor === undefined ? undefined : { gt: input.cursor },
                          },
                          orderBy: { cityId: 'asc' },
                          take: input.limit + 1,
                          select: { data: true },
                      })
                    : [];
                return {
                    ...world,
                    sample,
                    collected: Boolean(sample),
                    ...pageResult(
                        rows.map((row) => zAuditCityData.parse(row.data)),
                        input.limit,
                        (row) => row.id
                    ),
                };
            }
            const rows = await tx.city.findMany({
                where: { nationId: input.nationId, id: input.cursor === undefined ? undefined : { gt: input.cursor } },
                orderBy: { id: 'asc' },
                take: input.limit + 1,
                select: citySelect,
            });
            return {
                ...world,
                sample: null,
                collected: true,
                ...pageResult(rows.map(projectCurrentCity), input.limit, (row) => row.id),
            };
        })
    ),
});
