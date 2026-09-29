import {
    asRecord,
    GAME_TICKS_PER_TURN,
    OFFICE_REQUEST_KEY,
    officeRequestQuarter,
    readOfficeRequest,
    type OfficeRequest,
    type TurnDaemonCommand,
    type TurnDaemonCommandResult,
} from '@sammo-ts/common';
import {
    LogCategory,
    LogFormat,
    LogScope,
    resolveOfficeRequestEligibility,
    type OfficeCandidate,
} from '@sammo-ts/logic';
import type { InMemoryTurnWorld, TurnCalendarHandler } from './inMemoryWorld.js';
import type { TurnGeneral } from './types.js';

const candidate = (general: TurnGeneral): OfficeCandidate => ({
    ...general,
    strength: general.stats.strength,
    intelligence: general.stats.intelligence,
});
const incumbentFor = (world: InMemoryTurnWorld, cityId: number, level: number): TurnGeneral | undefined =>
    world
        .listGenerals()
        .find((g) => g.officerLevel === level && Number(g.meta.officerCity ?? g.meta.officer_city ?? 0) === cityId);
const eligibility = (world: InMemoryTurnWorld, general: TurnGeneral, cityId: number, level: 2 | 3 | 4) => {
    const incumbent = incumbentFor(world, cityId, level);
    return resolveOfficeRequestEligibility({
        applicant: candidate(general),
        city: world.getCityById(cityId) ?? null,
        level,
        incumbent: incumbent ? candidate(incumbent) : null,
        nationMeta: world.getNationById(general.nationId)?.meta,
        chiefStatMin: world.getScenarioConfig().stat.chiefMin,
    });
};
const save = (world: InMemoryTurnWorld, generalId: number, request: OfficeRequest) => {
    const general = world.getGeneralById(generalId);
    if (general) world.updateGeneral(generalId, { meta: { ...general.meta, [OFFICE_REQUEST_KEY]: { ...request } } });
};
const finish = (world: InMemoryTurnWorld, request: OfficeRequest, status: OfficeRequest['status'], reason: string) => {
    save(world, request.generalId, { ...request, status, resultReason: reason });
    const general = world.getGeneralById(request.generalId);
    if (!general) return;
    const city = world.getCityById(request.cityId);
    const title = { 2: '종사', 3: '군사', 4: '태수' }[request.officerLevel];
    const text = `${general.name} · ${city?.name ?? '도시'} ${title} 자원: ${reason}`;
    world.pushLog({
        scope: LogScope.GENERAL,
        generalId: general.id,
        category: LogCategory.ACTION,
        format: LogFormat.PLAIN,
        text,
    });
    world.pushLog({
        scope: LogScope.NATION,
        nationId: request.nationId,
        category: LogCategory.HISTORY,
        format: LogFormat.PLAIN,
        text,
    });
};
const invalidReason = (world: InMemoryTurnWorld, request: OfficeRequest): string | null => {
    const general = world.getGeneralById(request.generalId);
    if (!general || general.nationId !== request.nationId || general.userId !== request.userId)
        return '소속 또는 장수 소유자 변경';
    if ((incumbentFor(world, request.cityId, request.officerLevel)?.id ?? 0) !== request.incumbentId)
        return '재직자 변경';
    return eligibility(world, general, request.cityId, request.officerLevel).reason;
};
const approve = (world: InMemoryTurnWorld, request: OfficeRequest) => {
    const incumbent = incumbentFor(world, request.cityId, request.officerLevel);
    if (incumbent)
        world.updateGeneral(incumbent.id, {
            officerLevel: 1,
            meta: { ...incumbent.meta, officerCity: 0, officer_city: 0 },
        });
    const general = world.getGeneralById(request.generalId)!;
    world.updateGeneral(general.id, {
        officerLevel: request.officerLevel,
        meta: { ...general.meta, officerCity: request.cityId, officer_city: request.cityId },
    });
    const city = world.getCityById(request.cityId)!;
    world.updateCity(city.id, {
        meta: { ...city.meta, officer_set: Number(city.meta.officer_set ?? 0) | (1 << request.officerLevel) },
    });
    finish(world, request, 'approved', '임명');
};

// 분기 lock 초기화 뒤 실행한다. 저장된 기본 거부는 조건이 완화되어도 자동 승인으로 바꾸지 않는다.
export const settleCityOfficeRequests = (world: InMemoryTurnWorld, tick: number): void => {
    for (const general of world.listGenerals()) {
        const request = readOfficeRequest(general.meta);
        if (!request || request.status !== 'pending') continue;
        const invalid = invalidReason(world, request);
        if (invalid) {
            finish(world, request, 'cancelled', invalid);
            continue;
        }
        if (tick < request.dueTick) continue;
        const current = eligibility(world, general, request.cityId, request.officerLevel);
        if (request.defaultDecision === 'approve' && current.defaultDecision === 'approve') approve(world, request);
        else finish(world, request, 'rejected', '기한 만료 · 자동 거부');
    }
};
export const createCityOfficeRequestCalendarHandler = (
    getWorld: () => InMemoryTurnWorld | null
): TurnCalendarHandler => ({
    beforeMonthChanged: () => {
        const world = getWorld();
        if (world) settleCityOfficeRequests(world, Number.NEGATIVE_INFINITY);
    },
    onMonthChanged: (context) => {
        const world = getWorld();
        if (world) settleCityOfficeRequests(world, world.dateToGameTick(context.turnTime));
    },
});

export const handleCityOfficeRequest = (
    world: InMemoryTurnWorld,
    command: Extract<TurnDaemonCommand, { type: 'cityOfficeRequest' }>,
    acceptedAt: Date
): Extract<TurnDaemonCommandResult, { type: 'cityOfficeRequest' }> => {
    const fail = (reason: string): Extract<TurnDaemonCommandResult, { type: 'cityOfficeRequest' }> => ({
        type: 'cityOfficeRequest',
        generalId: command.generalId,
        ok: false,
        reason,
    });
    const actor = world.getGeneralById(command.generalId);
    if (!actor || actor.userId !== command.userId || !actor.nationId)
        return fail('장수 소유권 또는 소속이 변경되었습니다.');
    const tick = Math.max(world.dateToGameTick(world.getGameNow(acceptedAt)), world.getState().lastTurnTick ?? 0);
    settleCityOfficeRequests(world, tick);
    if (command.action === 'request') {
        if (!command.officerLevel) return fail('관직을 선택해 주세요.');
        const currentActor = world.getGeneralById(actor.id)!;
        const state = world.getState();
        const quarter = officeRequestQuarter(state.currentYear, state.currentMonth);
        const previous = readOfficeRequest(currentActor.meta);
        if (previous?.status === 'pending') return fail('이미 대기 중인 요청이 있습니다.');
        if (previous?.quarter === quarter) return fail('이번 분기에 이미 자원했습니다.');
        const check = eligibility(world, currentActor, currentActor.cityId, command.officerLevel);
        if (!check.allowed) return fail(check.reason!);
        const occupied = world.listGenerals().some((g) => {
            const pending = readOfficeRequest(g.meta);
            return (
                pending?.status === 'pending' &&
                pending.cityId === actor.cityId &&
                pending.officerLevel === command.officerLevel
            );
        });
        if (occupied) return fail('이미 다른 장수가 자원한 관직입니다.');
        const boundary = state.lastTurnTick ?? world.dateToGameTick(state.lastTurnTime);
        const dueTick =
            boundary +
            Math.max(1, Math.ceil((tick - boundary + GAME_TICKS_PER_TURN) / GAME_TICKS_PER_TURN)) * GAME_TICKS_PER_TURN;
        save(world, actor.id, {
            id: `${actor.id}:${quarter}`,
            generalId: actor.id,
            userId: command.userId,
            nationId: actor.nationId,
            cityId: actor.cityId,
            officerLevel: command.officerLevel,
            incumbentId: incumbentFor(world, actor.cityId, command.officerLevel)?.id ?? 0,
            quarter,
            createdTick: tick,
            dueTick,
            defaultDecision: check.defaultDecision,
            defaultReason: check.defaultReason,
            status: 'pending',
        });
    } else {
        const target = world.getGeneralById(command.targetGeneralId ?? actor.id);
        const request = readOfficeRequest(target?.meta);
        if (!request || request.id !== command.officeRequestId || request.status !== 'pending')
            return fail('이미 처리되었거나 없는 요청입니다.');
        if (request.nationId !== actor.nationId) return fail('다른 국가의 요청입니다.');
        if (command.action === 'withdraw') {
            if (request.generalId !== actor.id) return fail('본인의 요청만 철회할 수 있습니다.');
            finish(world, request, 'withdrawn', '본인 철회');
        } else {
            if (actor.officerLevel < 5 || asRecord(actor.penalty).noChief) return fail('수뇌만 처리할 수 있습니다.');
            if (command.action === 'reject') finish(world, request, 'rejected', '수뇌 거부');
            else {
                if (asRecord(actor.penalty).noChiefChange && target && target.officerLevel >= 4)
                    return fail('수뇌인 장수를 변경할 수 없는 상태입니다.');
                const invalid = invalidReason(world, request);
                if (invalid) return fail(invalid);
                approve(world, request);
            }
        }
    }
    return { type: 'cityOfficeRequest', generalId: actor.id, ok: true };
};
