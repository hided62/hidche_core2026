import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '../../trpc.js';
import { getMyGeneral } from '../shared/general.js';

const zGeneralSettings = z.object({
    tnmt: z.number().int().optional(),
    defence_train: z.number().int().optional(),
    use_treatment: z.number().int().optional(),
    use_auto_nation_turn: z.number().int().optional(),
});

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
            },
            city,
            nation,
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
});
