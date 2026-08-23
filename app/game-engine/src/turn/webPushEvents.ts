import { asRecord } from '@sammo-ts/common';
import type { WebPushOutboxEventInput } from '@sammo-ts/infra';

import type { InMemoryTurnWorld, TurnWorldChanges } from './inMemoryWorld.js';
import type { InMemoryReservedTurnStore, ReservedTurnChanges } from './reservedTurnStore.js';

interface GeneralNotificationState {
    userId: string | null;
    nationId: number;
    crew: number;
    deathCrew: number;
    autorunLimit: number | null;
}

export interface WebPushTurnBaseline {
    serverId: string;
    year: number;
    month: number;
    turnTick: string;
    generals: Map<number, GeneralNotificationState>;
    hasReservedTurns: Map<number, boolean>;
}

const readFiniteNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const readDeathCrew = (meta: Record<string, unknown>): number =>
    readFiniteNumber(meta.rank_deathcrew) ?? readFiniteNumber(meta.deathcrew) ?? 0;

const joinYearMonth = (year: number, month: number): number => year * 12 + month - 1;

export const captureWebPushTurnBaseline = (
    world: InMemoryTurnWorld,
    reservedTurns?: InMemoryReservedTurnStore
): WebPushTurnBaseline => {
    const state = world.getState();
    const meta = asRecord(state.meta);
    return {
        serverId: typeof meta.serverId === 'string' && meta.serverId ? meta.serverId : 'active-season',
        year: state.currentYear,
        month: state.currentMonth,
        turnTick: String(state.lastTurnTick ?? world.dateToGameTick(state.lastTurnTime)),
        generals: new Map(
            world.listGenerals().map((general) => {
                const generalMeta = asRecord(general.meta);
                return [
                    general.id,
                    {
                        userId: general.userId ?? null,
                        nationId: general.nationId,
                        crew: general.crew,
                        deathCrew: readDeathCrew(generalMeta),
                        autorunLimit: readFiniteNumber(generalMeta.autorun_limit),
                    },
                ];
            })
        ),
        hasReservedTurns: new Map(reservedTurns?.inspectGeneralTurnActivity() ?? []),
    };
};

export const buildTurnWebPushEvents = (input: {
    before: WebPushTurnBaseline;
    after: WebPushTurnBaseline;
    changes: Pick<TurnWorldChanges, 'deletedNationSnapshots'>;
    reservedTurnChanges?: Pick<ReservedTurnChanges, 'generalIds'>;
}): WebPushOutboxEventInput[] => {
    const events: WebPushOutboxEventInput[] = [];
    const { before, after } = input;

    for (const [generalId, current] of after.generals) {
        const previous = before.generals.get(generalId);
        if (!previous?.userId || previous.userId !== current.userId) continue;
        if (previous.crew > 0 && current.crew <= 0 && current.deathCrew > previous.deathCrew) {
            events.push({
                eventId: `${after.serverId}:troop-annihilated:${generalId}:${current.deathCrew}`,
                eventType: 'TROOP_ANNIHILATED',
                userIds: [current.userId],
            });
        }
    }

    const dirtyReservedGeneralIds = new Set(input.reservedTurnChanges?.generalIds ?? []);
    for (const generalId of dirtyReservedGeneralIds) {
        if (!before.hasReservedTurns.get(generalId) || after.hasReservedTurns.get(generalId)) continue;
        const userId = after.generals.get(generalId)?.userId ?? before.generals.get(generalId)?.userId;
        if (!userId) continue;
        events.push({
            eventId: `${after.serverId}:reserved-turns-ended:${generalId}:${after.turnTick}`,
            eventType: 'RESERVED_TURNS_ENDED',
            userIds: [userId],
        });
    }

    const beforeYearMonth = joinYearMonth(before.year, before.month);
    const afterYearMonth = joinYearMonth(after.year, after.month);
    if (afterYearMonth > beforeYearMonth) {
        events.push({
            eventId: `${after.serverId}:calendar:${after.year}:${after.month}`,
            eventType: 'TARGET_DATE_REACHED',
            year: after.year,
            month: after.month,
        });
        for (const [generalId, current] of after.generals) {
            const previous = before.generals.get(generalId);
            const limit = current.autorunLimit ?? previous?.autorunLimit;
            if (!current.userId || limit == null) continue;
            if (beforeYearMonth < limit && afterYearMonth >= limit) {
                events.push({
                    eventId: `${after.serverId}:autorun-ended:${generalId}:${limit}`,
                    eventType: 'AUTONOMOUS_ACTION_ENDED',
                    userIds: [current.userId],
                });
            }
        }
    }

    for (const snapshot of input.changes.deletedNationSnapshots) {
        const userIds = snapshot.generalIds
            .map((generalId) => before.generals.get(generalId)?.userId)
            .filter((userId): userId is string => Boolean(userId));
        if (userIds.length === 0) continue;
        events.push({
            eventId: `${after.serverId}:nation-destroyed:${snapshot.nation.id}:${snapshot.removedAt.toISOString()}`,
            eventType: 'NATION_DESTROYED',
            userIds,
        });
    }

    return events;
};
