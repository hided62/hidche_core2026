import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { LogCategory, LogScope } from '@sammo-ts/infra';
import { asRecord } from '@sammo-ts/common';

import { authedProcedure, router } from '../../trpc.js';
import { getMyGeneral } from '../shared/general.js';

const zGeneralSettings = z.object({
    tnmt: z.number().int().optional(),
    defence_train: z.number().int().optional(),
    use_treatment: z.number().int().optional(),
    use_auto_nation_turn: z.number().int().optional(),
});

const zGeneralLogType = z.enum(['generalHistory', 'battleDetail', 'battleResult', 'generalAction']);

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
    const settings = asRecord(meta.userSettings);
    const mysetRaw = settings.myset;
    const myset = typeof mysetRaw === 'number' && Number.isFinite(mysetRaw) ? mysetRaw : null;

    return {
        tnmt: readNumber(settings.tnmt, 1),
        defence_train: readNumber(settings.defence_train, 80),
        use_treatment: readNumber(settings.use_treatment, 10),
        use_auto_nation_turn: readNumber(settings.use_auto_nation_turn, 1),
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
    buildNationCandidate: authedProcedure.mutation(async ({ ctx }) => {
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'buildNationCandidate',
            generalId: general.id,
        });
        if (!result || result.type !== 'buildNationCandidate') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }
        return { ok: true };
    }),
    instantRetreat: authedProcedure.mutation(async ({ ctx }) => {
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'instantRetreat',
            generalId: general.id,
        });
        if (!result || result.type !== 'instantRetreat') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }
        return { ok: true };
    }),
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

        const metaRecord = asRecord(general.meta);
        const prevSettings = asRecord(metaRecord.userSettings);
        const prevMyset = typeof prevSettings.myset === 'number' && Number.isFinite(prevSettings.myset)
            ? prevSettings.myset
            : null;
        const nextSettings = {
            ...prevSettings,
            ...input,
        } as Record<string, unknown>;
        if (typeof prevMyset === 'number') {
            nextSettings.myset = Math.max(0, prevMyset - 1);
        }

        await ctx.db.general.update({
            where: { id: general.id },
            data: {
                meta: {
                    ...metaRecord,
                    userSettings: nextSettings,
                },
            } as any,
        });

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
});
