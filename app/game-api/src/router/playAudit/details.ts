import { z } from 'zod';
import { auditProcedure, findAuditMonth, readAudit, readAuditWorld, zAuditMonth } from './shared.js';
import {
    citySelect,
    generalSelect,
    projectCurrentCity,
    projectCurrentGeneral,
    zAuditCityData,
    zAuditGeneralData,
} from './projection.js';

const identity = z.object({ id: z.number(), name: z.string() });
const zDetail = z.object({ id: z.number().int().nonnegative(), at: zAuditMonth.optional() }).strict();

export const generalDetail = auditProcedure.input(zDetail).query(({ ctx, input }) =>
    readAudit(ctx, async (tx) => {
        const world = await readAuditWorld(tx);
        if (input.at) {
            const sample = await findAuditMonth(tx, world, input.at);
            const row = sample
                ? await tx.playAuditGeneral.findUnique({
                      where: { sampleId_generalId: { sampleId: sample.id, generalId: input.id } },
                      select: { data: true },
                  })
                : null;
            const general = row ? zAuditGeneralData.parse(row.data) : null;
            const nation =
                general && sample
                    ? await tx.playAuditNation.findUnique({
                          where: { sampleId_nationId: { sampleId: sample.id, nationId: general.nationId } },
                          select: { data: true },
                      })
                    : null;
            const city =
                general && sample
                    ? await tx.playAuditCity.findUnique({
                          where: { sampleId_cityId: { sampleId: sample.id, cityId: general.cityId } },
                          select: { data: true },
                      })
                    : null;
            return {
                ...world,
                sample,
                collected: Boolean(sample),
                general,
                nation: nation ? identity.parse(nation.data) : null,
                city: city ? identity.parse(city.data) : null,
            };
        }
        const row = await tx.general.findUnique({ where: { id: input.id }, select: generalSelect });
        const general = row ? projectCurrentGeneral(row) : null;
        const nation = general
            ? await tx.nation.findUnique({ where: { id: general.nationId }, select: { id: true, name: true } })
            : null;
        const city = general
            ? await tx.city.findUnique({ where: { id: general.cityId }, select: { id: true, name: true } })
            : null;
        return { ...world, sample: null, collected: true, general, nation, city };
    })
);

export const cityDetail = auditProcedure.input(zDetail).query(({ ctx, input }) =>
    readAudit(ctx, async (tx) => {
        const world = await readAuditWorld(tx);
        if (input.at) {
            const sample = await findAuditMonth(tx, world, input.at);
            const row = sample
                ? await tx.playAuditCity.findUnique({
                      where: { sampleId_cityId: { sampleId: sample.id, cityId: input.id } },
                      select: { data: true },
                  })
                : null;
            const city = row ? zAuditCityData.parse(row.data) : null;
            const nation =
                city && sample
                    ? await tx.playAuditNation.findUnique({
                          where: { sampleId_nationId: { sampleId: sample.id, nationId: city.nationId } },
                          select: { data: true },
                      })
                    : null;
            return {
                ...world,
                sample,
                collected: Boolean(sample),
                city,
                nation: nation ? identity.parse(nation.data) : null,
            };
        }
        const row = await tx.city.findUnique({ where: { id: input.id }, select: citySelect });
        const city = row ? projectCurrentCity(row) : null;
        const nation = city
            ? await tx.nation.findUnique({ where: { id: city.nationId }, select: { id: true, name: true } })
            : null;
        return { ...world, sample: null, collected: true, city, nation };
    })
);

// 현재 예약은 과거 표본과 분리한다. 잘못된 slot도 숨기지 않고 페이지로 조회한다.
export const generalTurns = auditProcedure
    .input(
        z
            .object({
                generalId: z.number().int().nonnegative(),
                cursor: z.number().int().optional(),
                limit: z.number().int().min(1).max(200).default(50),
            })
            .strict()
    )
    .query(({ ctx, input }) =>
        readAudit(ctx, async (tx) => {
            const world = await readAuditWorld(tx);
            const general = await tx.general.findUnique({ where: { id: input.generalId }, select: { id: true } });
            const rows = general
                ? await tx.generalTurn.findMany({
                      where: {
                          generalId: input.generalId,
                          turnIdx: input.cursor === undefined ? undefined : { gt: input.cursor },
                      },
                      orderBy: { turnIdx: 'asc' },
                      take: input.limit + 1,
                      select: { turnIdx: true, actionCode: true, arg: true },
                  })
                : [];
            return {
                ...world,
                currentOnly: true,
                generalExists: Boolean(general),
                items: rows
                    .slice(0, input.limit)
                    .map((row) => ({
                        turnIdx: row.turnIdx,
                        actionCode: row.actionCode,
                        argumentJson: JSON.stringify(row.arg),
                    })),
                nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.turnIdx : null,
            };
        })
    );
