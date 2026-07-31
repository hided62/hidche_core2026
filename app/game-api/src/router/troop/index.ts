import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { TurnDaemonCommandResult } from '@sammo-ts/common';
import { isValidTroopNameWidth, normalizeTroopName, resolveTroopSecretPermission } from '@sammo-ts/logic';

import { accessAuthedProcedure, authedProcedure, router } from '../../trpc.js';
import { getMyGeneral } from '../shared/general.js';

const troopNameSchema = z
    .string()
    .refine(isValidTroopNameWidth, '부대 이름은 전각 9자 또는 반각 18자 이하여야 합니다.');

const normalizeRequiredTroopName = (value: string): string => {
    const name = normalizeTroopName(value);
    if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '부대 이름이 없습니다.' });
    }
    return name;
};

const assertCommandResult = <T extends 'troopCreate' | 'troopJoin' | 'troopExit' | 'troopKick' | 'troopRename'>(
    result: TurnDaemonCommandResult | null,
    expectedType: T
): never => {
    if (!result) {
        throw new TRPCError({ code: 'TIMEOUT', message: 'Turn daemon did not respond.' });
    }
    throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Unexpected turn daemon response for ${expectedType}.`,
    });
};

export const troopRouter = router({
    getList: accessAuthedProcedure.query(async ({ ctx }) => {
        const me = await getMyGeneral(ctx);
        if (me.nationId <= 0) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '국가에 소속되어 있지 않습니다.' });
        }

        const [nation, troops, generals, cities] = await Promise.all([
            ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: { id: true, name: true, meta: true },
            }),
            ctx.db.troop.findMany({
                where: { nationId: me.nationId },
                select: { troopLeaderId: true, nationId: true, name: true },
            }),
            ctx.db.general.findMany({
                where: { nationId: me.nationId },
                select: {
                    id: true,
                    name: true,
                    cityId: true,
                    troopId: true,
                    picture: true,
                    imageServer: true,
                    turnTime: true,
                },
            }),
            ctx.db.city.findMany({
                select: { id: true, name: true },
            }),
        ]);
        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '국가 정보를 찾을 수 없습니다.' });
        }

        const troopLeaderIds = troops.map((troop) => troop.troopLeaderId);
        const turns =
            troopLeaderIds.length === 0
                ? []
                : await ctx.db.generalTurn.findMany({
                      where: { generalId: { in: troopLeaderIds } },
                      select: { generalId: true, turnIdx: true, actionCode: true },
                      orderBy: [{ generalId: 'asc' }, { turnIdx: 'asc' }],
                  });
        const cityNames = new Map(cities.map((city) => [city.id, city.name]));
        const generalMap = new Map(generals.map((general) => [general.id, general]));
        const reservedByLeader = new Map<number, string[]>();
        for (const turn of turns) {
            const list = reservedByLeader.get(turn.generalId) ?? [];
            list.push(turn.actionCode);
            reservedByLeader.set(turn.generalId, list);
        }

        const mappedTroops = troops
            .map((troop) => {
                const leader = generalMap.get(troop.troopLeaderId);
                return {
                    id: troop.troopLeaderId,
                    name: troop.name,
                    nationId: troop.nationId,
                    turnTime: leader?.turnTime.toISOString() ?? null,
                    reservedCommands: reservedByLeader.get(troop.troopLeaderId) ?? [],
                    leader: leader
                        ? {
                              id: leader.id,
                              name: leader.name,
                              cityId: leader.cityId,
                              cityName: cityNames.get(leader.cityId) ?? '알 수 없음',
                              picture: leader.picture,
                              imageServer: leader.imageServer,
                          }
                        : null,
                    members: generals
                        .filter((general) => general.troopId === troop.troopLeaderId)
                        .map((general) => ({
                            id: general.id,
                            name: general.name,
                            cityId: general.cityId,
                            cityName: cityNames.get(general.cityId) ?? '알 수 없음',
                        })),
                };
            })
            .sort((left, right) => {
                const timeOrder = (left.turnTime ?? '').localeCompare(right.turnTime ?? '');
                return timeOrder || left.id - right.id;
            });

        return {
            nation: { id: nation.id, name: nation.name },
            me: { id: me.id, troopId: me.troopId },
            permission: resolveTroopSecretPermission(me, nation.meta, false),
            troops: mappedTroops,
        };
    }),
    create: authedProcedure.input(z.object({ troopName: troopNameSchema })).mutation(async ({ ctx, input }) => {
        const me = await getMyGeneral(ctx);
        const troopName = normalizeRequiredTroopName(input.troopName);
        if (me.troopId !== 0) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: '이미 부대에 소속되어 있습니다.',
            });
        }
        if (me.nationId <= 0) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: '국가에 소속되어 있지 않습니다.',
            });
        }
        const result = await ctx.turnDaemon.requestCommand({
            type: 'troopCreate',
            generalId: me.id,
            troopName,
        });
        if (!result || result.type !== 'troopCreate') {
            return assertCommandResult(result, 'troopCreate');
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: result.reason });
        }
        return { ok: true, troopId: result.troopId, troopName: result.troopName };
    }),
    join: authedProcedure.input(z.object({ troopId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
        const me = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'troopJoin',
            generalId: me.id,
            troopId: input.troopId,
        });
        if (!result || result.type !== 'troopJoin') {
            return assertCommandResult(result, 'troopJoin');
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: result.reason });
        }
        return { ok: true };
    }),
    exit: authedProcedure.mutation(async ({ ctx }) => {
        const me = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'troopExit',
            generalId: me.id,
        });
        if (!result || result.type !== 'troopExit') {
            return assertCommandResult(result, 'troopExit');
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: result.reason });
        }
        return { ok: true, wasLeader: result.wasLeader };
    }),
    kick: authedProcedure
        .input(
            z.object({
                troopId: z.number().int().positive(),
                targetGeneralId: z.number().int().positive(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            if (me.id !== input.troopId || me.troopId !== me.id) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
            }
            const target = await ctx.db.general.findUnique({
                where: { id: input.targetGeneralId },
                select: { id: true, troopId: true },
            });
            if (!target) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '장수 정보를 찾을 수 없습니다.' });
            }
            if (target.troopId === 0) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '부대에 소속되어 있지 않습니다.' });
            }
            if (target.troopId !== input.troopId) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '다른 부대에 소속되어 있습니다.' });
            }
            if (target.id === input.troopId) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '부대장을 추방할 수 없습니다.' });
            }

            const result = await ctx.turnDaemon.requestCommand({
                type: 'troopKick',
                generalId: me.id,
                troopId: input.troopId,
                targetGeneralId: input.targetGeneralId,
            });
            if (!result || result.type !== 'troopKick') {
                return assertCommandResult(result, 'troopKick');
            }
            if (!result.ok) {
                const code = result.reason === '권한이 부족합니다.' ? 'FORBIDDEN' : 'PRECONDITION_FAILED';
                throw new TRPCError({ code, message: result.reason });
            }
            return { ok: true };
        }),
    rename: authedProcedure
        .input(
            z.object({
                troopId: z.number().int().positive(),
                troopName: troopNameSchema,
            })
        )
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            const troopName = normalizeRequiredTroopName(input.troopName);
            const nation = await ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: { meta: true },
            });
            const permission = resolveTroopSecretPermission(me, nation?.meta ?? {}, false);
            if (me.id !== input.troopId && permission < 4) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
            }
            const troop = await ctx.db.troop.findUnique({
                where: { troopLeaderId: input.troopId },
                select: { nationId: true },
            });
            if (!troop || me.nationId <= 0 || troop.nationId !== me.nationId) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '부대가 없습니다.' });
            }

            const result = await ctx.turnDaemon.requestCommand({
                type: 'troopRename',
                generalId: me.id,
                troopId: input.troopId,
                troopName,
            });
            if (!result || result.type !== 'troopRename') {
                return assertCommandResult(result, 'troopRename');
            }
            if (!result.ok) {
                const code = result.reason === '권한이 부족합니다.' ? 'FORBIDDEN' : 'PRECONDITION_FAILED';
                throw new TRPCError({ code, message: result.reason });
            }
            return { ok: true, troopName: result.troopName };
        }),
});
