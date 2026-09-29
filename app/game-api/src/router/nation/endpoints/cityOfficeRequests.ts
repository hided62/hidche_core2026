import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
    asRecord,
    GAME_TICKS_PER_TURN,
    officeRequestQuarter,
    readOfficeRequest,
    type CityOfficeLevel,
} from '@sammo-ts/common';
import { resolveOfficeRequestEligibility, type OfficeCandidate } from '@sammo-ts/logic';
import { accessAuthedProcedure, engineAuthedProcedure } from '../../../trpc.js';
import { getAuthenticatedUserId, getMyGeneral } from '../../shared/general.js';
import { throwIfCommandRejected } from '../../shared/turnDaemon.js';
import { assertNationAccess, resolveChiefStatMin } from '../shared.js';
import { loadCurrentGameTime } from '../../../services/gameClock.js';

export const cityOfficeRequest = engineAuthedProcedure
    .input(
        z.discriminatedUnion('action', [
            z.object({
                action: z.literal('request'),
                officerLevel: z.union([z.literal(2), z.literal(3), z.literal(4)]),
            }),
            z.object({
                action: z.enum(['approve', 'reject', 'withdraw']),
                targetGeneralId: z.number().int().positive(),
                officeRequestId: z.string().min(1),
            }),
        ])
    )
    .mutation(async ({ ctx, input }) => {
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            ...input,
            type: 'cityOfficeRequest',
            userId: getAuthenticatedUserId(ctx),
            generalId: general.id,
            ...(ctx.requestId
                ? { requestId: `${ctx.requestId}:nation.cityOfficeRequest:engine:0:cityOfficeRequest` }
                : {}),
        });
        throwIfCommandRejected(result);
        if (!result || result.type !== 'cityOfficeRequest')
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        if (!result.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        return { ok: true };
    });

export const getCityOfficeRequests = accessAuthedProcedure.query(async ({ ctx }) => {
    const me = await getMyGeneral(ctx);
    assertNationAccess(me);
    const [nation, cities, rows, state, clock] = await Promise.all([
        ctx.db.nation.findUnique({ where: { id: me.nationId }, select: { meta: true } }),
        ctx.db.city.findMany({
            where: { nationId: me.nationId },
            select: { id: true, nationId: true, name: true, meta: true },
        }),
        ctx.db.general.findMany({
            where: { nationId: me.nationId },
            select: {
                id: true,
                userId: true,
                name: true,
                nationId: true,
                cityId: true,
                officerLevel: true,
                npcState: true,
                strength: true,
                intel: true,
                meta: true,
                penalty: true,
            },
        }),
        ctx.db.worldState.findFirst(),
        loadCurrentGameTime(ctx.db),
    ]);
    if (!nation || !state)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '국가 또는 게임 상태를 찾을 수 없습니다.' });
    const candidates = rows.map((row) => ({ ...row, intelligence: row.intel }));
    const applicant: OfficeCandidate = { ...me, intelligence: me.intel };
    const city = cities.find((entry) => entry.id === me.cityId) ?? null;
    const quarter = officeRequestQuarter(state.currentYear, state.currentMonth);
    const own = readOfficeRequest(me.meta);
    const requests = candidates.flatMap((general) => {
        const request = readOfficeRequest(general.meta);
        if (
            !request ||
            request.generalId !== general.id ||
            request.nationId !== me.nationId ||
            request.userId !== general.userId
        )
            return [];
        return [{ general, request }];
    });
    const evaluate = (general: OfficeCandidate, cityId: number, level: CityOfficeLevel) =>
        resolveOfficeRequestEligibility({
            applicant: general,
            city: cities.find((entry) => entry.id === cityId) ?? null,
            level,
            incumbent:
                candidates.find(
                    (entry) =>
                        entry.officerLevel === level &&
                        Number(asRecord(entry.meta).officerCity ?? asRecord(entry.meta).officer_city ?? 0) === cityId
                ) ?? null,
            nationMeta: nation.meta,
            chiefStatMin: resolveChiefStatMin(state),
        });
    const canManage = me.officerLevel >= 5 && !asRecord(me.penalty).noChief;
    const nowTick = clock.tick;
    const options = ([4, 3, 2] as const).map((level) => {
        const check = evaluate(applicant, me.cityId, level);
        const occupied = requests.some(
            ({ request }) =>
                request.status === 'pending' && request.cityId === me.cityId && request.officerLevel === level
        );
        const reason =
            check.reason ??
            (own?.status === 'pending'
                ? '요청 대기 중'
                : own?.quarter === quarter
                  ? '이번 분기 자원 완료'
                  : occupied
                    ? '다른 장수 자원 중'
                    : nowTick === null
                      ? '게임 시계 준비 중'
                      : null);
        return { level, ...check, allowed: !reason, reason };
    });
    return {
        canManage,
        generalId: me.id,
        nationId: me.nationId,
        serverId: String(asRecord(state.meta).serverId ?? ctx.profile?.name ?? 'game'),
        city: city ? { id: city.id, name: city.name } : null,
        options,
        running: clock.running,
        tickSeconds: state.tickSeconds,
        requests: requests
            .filter(({ general, request }) => general.id === me.id || (canManage && request.status === 'pending'))
            .map(({ general, request }) => {
                const check = evaluate(general, request.cityId, request.officerLevel);
                const defaultDecision =
                    request.defaultDecision === 'reject' || check.defaultDecision === 'reject'
                        ? ('reject' as const)
                        : ('approve' as const);
                const months = Math.max(
                    0,
                    Math.ceil((request.dueTick - Number(state.lastTurnTick ?? 0)) / GAME_TICKS_PER_TURN)
                );
                const monthIndex = state.currentYear * 12 + state.currentMonth - 1 + months;
                return {
                    id: request.id,
                    generalId: general.id,
                    generalName: general.name,
                    cityId: request.cityId,
                    cityName: cities.find((entry) => entry.id === request.cityId)?.name ?? '-',
                    officerLevel: request.officerLevel,
                    status: request.status,
                    defaultDecision,
                    defaultReason: check.defaultReason === 'secret' ? ('secret' as const) : request.defaultReason,
                    resultReason: request.resultReason ?? null,
                    dueYear: Math.floor(monthIndex / 12),
                    dueMonth: (monthIndex % 12) + 1,
                    remainingSeconds:
                        nowTick === null
                            ? null
                            : Math.max(0, ((request.dueTick - nowTick) / GAME_TICKS_PER_TURN) * state.tickSeconds),
                    invalidReason: request.status === 'pending' ? check.reason : null,
                };
            }),
    };
});
