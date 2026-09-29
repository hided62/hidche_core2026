import { describe, expect, it } from 'vitest';
import { GAME_TICKS_PER_TURN, readOfficeRequest, shiftOfficeRequestDeadline } from '@sammo-ts/common';
import { buildGeneral, buildWorld } from './officeRequestFixture.js';
import {
    handleCityOfficeRequest,
    settleCityOfficeRequests,
    createCityOfficeRequestCalendarHandler,
} from '../src/turn/cityOfficeRequests.js';
const acceptedAt = new Date('0185-01-01T00:00:00Z');
const request = (world: ReturnType<typeof buildWorld>['world'], generalId = 3) =>
    handleCityOfficeRequest(
        world,
        { type: 'cityOfficeRequest', userId: `user-${generalId}`, generalId, action: 'request', officerLevel: 4 },
        acceptedAt
    );
const pending = (world: ReturnType<typeof buildWorld>['world']) => readOfficeRequest(world.getGeneralById(3)?.meta)!;
const decide = (
    world: ReturnType<typeof buildWorld>['world'],
    action: 'approve' | 'reject' | 'withdraw',
    generalId = 2
) =>
    handleCityOfficeRequest(
        world,
        {
            type: 'cityOfficeRequest',
            userId: `user-${generalId}`,
            generalId,
            action,
            targetGeneralId: 3,
            officeRequestId: pending(world).id,
        },
        acceptedAt
    );

describe('city office request policy and lifecycle', () => {
    it.each([null, 2, 3])('defaults vacancy / N / M (%s) to approval only at the deadline', (npc) => {
        const { world } = buildWorld({
            generals: [
                buildGeneral(2, { officerLevel: 5 }),
                buildGeneral(3),
                ...(npc === null
                    ? []
                    : [
                          buildGeneral(4, {
                              userId: null,
                              npcState: npc,
                              officerLevel: 4,
                              meta: { killturn: 12, officerCity: 1 },
                          }),
                      ]),
            ],
        });
        expect(request(world)).toMatchObject({ ok: true });
        const entry = pending(world);
        expect(entry).toMatchObject({ defaultDecision: 'approve', status: 'pending' });
        expect(entry.dueTick - entry.createdTick).toBeGreaterThanOrEqual(GAME_TICKS_PER_TURN);
        settleCityOfficeRequests(world, entry.dueTick - 1);
        expect(world.getGeneralById(3)?.officerLevel).toBe(1);
        settleCityOfficeRequests(world, entry.dueTick);
        expect(pending(world).status).toBe('approved');
        expect(world.getGeneralById(3)).toMatchObject({ officerLevel: 4, meta: { officerCity: 1, officer_city: 1 } });
        expect(Number(world.getCityById(1)?.meta.officer_set) & 16).toBe(16);
        if (npc !== null) expect(world.getGeneralById(4)?.officerLevel).toBe(1);
        settleCityOfficeRequests(world, entry.dueTick + GAME_TICKS_PER_TURN);
        expect(pending(world).status).toBe('approved');
    });
    it.each(['absent', 'secret'] as const)('defaults %s to rejection but lets a chief explicitly approve', (reason) => {
        for (const manual of [false, true]) {
            const { world } = buildWorld({
                generals: [
                    buildGeneral(2, { officerLevel: 5 }),
                    buildGeneral(3, reason === 'secret' ? { meta: { killturn: 12, belong: 0 } } : {}),
                    ...(reason === 'absent'
                        ? [buildGeneral(4, { cityId: 2, officerLevel: 4, meta: { killturn: 12, officerCity: 1 } })]
                        : []),
                ],
            });
            expect(request(world)).toMatchObject({ ok: true });
            expect(pending(world)).toMatchObject({ defaultDecision: 'reject', defaultReason: reason });
            if (manual) expect(decide(world, 'approve')).toMatchObject({ ok: true });
            else settleCityOfficeRequests(world, pending(world).dueTick);
            expect(pending(world).status).toBe(manual ? 'approved' : 'rejected');
        }
    });
    it.each([0, 1])('does not replace a stationed user / possessed general (%s)', (npcState) => {
        const { world } = buildWorld({
            generals: [
                buildGeneral(3),
                buildGeneral(4, { npcState, officerLevel: 4, meta: { killturn: 12, officerCity: 1 } }),
            ],
        });
        expect(request(world)).toMatchObject({ ok: false, reason: '재직자가 도시에 체류 중' });
    });
    it('lets chiefs approve or reject default approval, and permits owner withdrawal', () => {
        for (const action of ['approve', 'reject', 'withdraw'] as const) {
            const { world } = buildWorld({});
            request(world);
            expect(decide(world, action, action === 'withdraw' ? 3 : 2)).toMatchObject({ ok: true });
            expect(pending(world).status).toBe(
                { approve: 'approved', reject: 'rejected', withdraw: 'withdrawn' }[action]
            );
            expect(request(world).ok).toBe(false);
        }
    });
    it('rejects forged actors, ordinary approvers, foreign chiefs and stale request IDs', () => {
        const { world } = buildWorld({});
        request(world);
        expect(decide(world, 'approve', 3).ok).toBe(false);
        world.updateGeneral(2, { nationId: 9 });
        expect(decide(world, 'approve').ok).toBe(false);
        expect(
            handleCityOfficeRequest(
                world,
                {
                    type: 'cityOfficeRequest',
                    userId: 'forged',
                    generalId: 3,
                    action: 'withdraw',
                    officeRequestId: pending(world).id,
                },
                acceptedAt
            ).ok
        ).toBe(false);
        expect(
            handleCityOfficeRequest(
                world,
                {
                    type: 'cityOfficeRequest',
                    userId: 'user-3',
                    generalId: 3,
                    action: 'withdraw',
                    officeRequestId: 'stale',
                },
                acceptedAt
            ).ok
        ).toBe(false);
        expect(pending(world).status).toBe('pending');
    });
    it.each(['move', 'nation', 'owner', 'occupation', 'lock', 'stat', 'penalty'] as const)(
        'cancels after %s changes before settlement',
        (change) => {
            const { world } = buildWorld({});
            request(world);
            const general = world.getGeneralById(3)!;
            if (change === 'move') world.updateGeneral(3, { cityId: 2 });
            if (change === 'nation') world.updateGeneral(3, { nationId: 2 });
            if (change === 'owner') world.updateGeneral(3, { userId: 'other' });
            if (change === 'occupation') world.updateCity(1, { nationId: 2 });
            if (change === 'lock') world.updateCity(1, { meta: { officer_set: 16 } });
            if (change === 'stat') world.updateGeneral(3, { stats: { ...general.stats, strength: 0 } });
            if (change === 'penalty') world.updateGeneral(3, { penalty: { noChief: true } });
            settleCityOfficeRequests(world, pending(world).dueTick);
            expect(pending(world).status).toBe('cancelled');
            expect(world.getGeneralById(3)?.officerLevel).toBe(1);
        }
    );
    it('does not auto-grant newly restricted secrets or upgrade a stored rejection', () => {
        const { world } = buildWorld({});
        request(world);
        world.updateNation(1, { meta: { secretlimit: 10 } });
        settleCityOfficeRequests(world, pending(world).dueTick);
        expect(pending(world).status).toBe('rejected');
    });
    it('reserves a slot against other applicants but not a manual chief appointment', async () => {
        const { world, handler } = buildWorld({
            generals: [buildGeneral(2, { officerLevel: 5 }), buildGeneral(3), buildGeneral(4)],
        });
        request(world);
        expect(request(world, 4).ok).toBe(false);
        expect(
            await handler.handle({
                type: 'appoint',
                userId: 'user-2',
                generalId: 2,
                destGeneralId: 4,
                destCityId: 1,
                officerLevel: 4,
            })
        ).toMatchObject({ ok: true });
        expect(pending(world).status).toBe('cancelled');
        expect(world.getGeneralById(4)?.officerLevel).toBe(4);
    });
    it('uses the monthly calendar boundary and survives a world snapshot reload', async () => {
        const { world } = buildWorld({});
        request(world);
        const saved = JSON.parse(JSON.stringify(world.getGeneralById(3)?.meta));
        const { world: reloaded } = buildWorld({ generals: [buildGeneral(3, { meta: saved })] });
        await createCityOfficeRequestCalendarHandler(() => reloaded).onMonthChanged?.({
            previousYear: 185,
            previousMonth: 1,
            currentYear: 185,
            currentMonth: 2,
            turnTime: reloaded.gameTickToDate(pending(reloaded).dueTick),
        });
        expect(pending(reloaded).status).toBe('approved');
    });
});

it('preserves a full review month for requests accepted just before a month boundary', () => {
    const { world } = buildWorld({
        clock: {
            clockBaseTime: acceptedAt,
            clockWallAnchor: acceptedAt,
            clockMode: 'manual',
            clockTick: GAME_TICKS_PER_TURN - 1,
            lastTurnTick: 0,
        },
    });
    expect(request(world)).toMatchObject({ ok: true });
    expect(pending(world).dueTick).toBe(2 * GAME_TICKS_PER_TURN);
    settleCityOfficeRequests(world, GAME_TICKS_PER_TURN);
    expect(pending(world).status).toBe('pending');
});

it('releases the quarterly applicant limit next quarter while preserving same-quarter refusal', () => {
    const { world } = buildWorld({});
    request(world);
    decide(world, 'reject');
    expect(request(world).ok).toBe(false);
    const previous = pending(world);
    world.updateGeneral(3, {
        meta: { ...world.getGeneralById(3)!.meta, cityOfficeRequest: { ...previous, quarter: previous.quarter - 1 } },
    });
    expect(request(world).ok).toBe(true);
});

it('cancels pending requests before quarterly locks reset', async () => {
    const { world } = buildWorld({});
    request(world);
    world.updateCity(1, { meta: { officer_set: 16 } });
    await createCityOfficeRequestCalendarHandler(() => world).beforeMonthChanged?.({
        previousYear: 185,
        previousMonth: 3,
        currentYear: 185,
        currentMonth: 4,
        turnTime: acceptedAt,
    });
    expect(pending(world).status).toBe('cancelled');
});

it('does not relax a stored secret rejection when tenure increases', () => {
    const { world } = buildWorld({ generals: [buildGeneral(3, { meta: { killturn: 12, belong: 0 } })] });
    request(world);
    world.updateGeneral(3, { meta: { ...world.getGeneralById(3)!.meta, belong: 10 } });
    settleCityOfficeRequests(world, pending(world).dueTick);
    expect(pending(world).status).toBe('rejected');
});

it('moves pending deadlines on backlog rebase and preserves occurrence ticks', () => {
    const anchor = new Date('2026-01-01T00:00:00Z');
    const { world } = buildWorld({
        clock: { clockBaseTime: anchor, clockWallAnchor: anchor, clockMode: 'realtime', clockTick: 0, lastTurnTick: 0 },
    });
    expect(
        handleCityOfficeRequest(
            world,
            { type: 'cityOfficeRequest', userId: 'user-3', generalId: 3, action: 'request', officerLevel: 4 },
            anchor
        )
    ).toMatchObject({ ok: true });
    const before = pending(world);
    const shifted = world.rebaseRealtimeBacklog(new Date(anchor.getTime() + 13 * 600_000));
    expect(shifted?.shiftedTicks).toBe(12 * GAME_TICKS_PER_TURN);
    expect(pending(world)).toMatchObject({
        createdTick: before.createdTick,
        dueTick: before.dueTick + shifted!.shiftedTicks,
    });
    const completed = { ...world.getGeneralById(3)!.meta, cityOfficeRequest: { ...before, status: 'approved' } };
    expect(shiftOfficeRequestDeadline(completed, 10)).toEqual(completed);
    expect(shiftOfficeRequestDeadline(world.getGeneralById(3)!.meta, 10, pending(world).dueTick + 1)).toEqual(
        world.getGeneralById(3)!.meta
    );
});

it('uses the existing secret-limit fallback for malformed metadata', () => {
    const { world } = buildWorld({
        nationMeta: { secretlimit: 'invalid' },
        generals: [buildGeneral(3, { meta: { killturn: 12, belong: 'invalid' } })],
    });
    expect(request(world)).toMatchObject({ ok: true });
    expect(pending(world).defaultDecision).toBe('reject');
});
