import { describe, expect, it } from 'vitest';

import { buildTurnWebPushEvents, type WebPushTurnBaseline } from '../src/turn/webPushEvents.js';

const general = (
    userId: string | null,
    options: { nationId?: number; crew?: number; deathCrew?: number; autorunLimit?: number | null } = {}
) => ({
    userId,
    nationId: options.nationId ?? 1,
    crew: options.crew ?? 100,
    deathCrew: options.deathCrew ?? 0,
    autorunLimit: options.autorunLimit ?? null,
});

const baseline = (input: Partial<WebPushTurnBaseline> = {}): WebPushTurnBaseline => ({
    serverId: 'season-1',
    year: 200,
    month: 1,
    turnTick: '100',
    generals: new Map(),
    hasReservedTurns: new Map(),
    ...input,
});

describe('turn web push event projection', () => {
    it('emits annihilation only when battle casualty totals also increase', () => {
        const before = baseline({ generals: new Map([[1, general('user-1', { crew: 500, deathCrew: 10 })]]) });
        const battleAfter = baseline({
            generals: new Map([[1, general('user-1', { crew: 0, deathCrew: 510 })]]),
            turnTick: '101',
        });
        const disbandAfter = baseline({
            generals: new Map([[1, general('user-1', { crew: 0, deathCrew: 10 })]]),
            turnTick: '101',
        });

        expect(buildTurnWebPushEvents({ before, after: battleAfter, changes: { deletedNationSnapshots: [] } })).toEqual(
            [expect.objectContaining({ eventType: 'TROOP_ANNIHILATED', userIds: ['user-1'] })]
        );
        expect(
            buildTurnWebPushEvents({ before, after: disbandAfter, changes: { deletedNationSnapshots: [] } })
        ).toEqual([]);
    });

    it('emits reserved-turn completion only for a dirty queue that consumed its last command', () => {
        const before = baseline({
            generals: new Map([[1, general('user-1')]]),
            hasReservedTurns: new Map([[1, true]]),
        });
        const after = baseline({
            generals: new Map([[1, general('user-1')]]),
            hasReservedTurns: new Map([[1, false]]),
            turnTick: '102',
        });
        const events = buildTurnWebPushEvents({
            before,
            after,
            changes: { deletedNationSnapshots: [] },
            reservedTurnChanges: { generalIds: [1] },
        });
        expect(events).toEqual([expect.objectContaining({ eventType: 'RESERVED_TURNS_ENDED', userIds: ['user-1'] })]);
    });

    it('emits calendar and autonomous-expiry events at the exclusive limit month', () => {
        const before = baseline({
            year: 200,
            month: 1,
            generals: new Map([[1, general('user-1', { autorunLimit: 2401 })]]),
        });
        const after = baseline({
            year: 200,
            month: 2,
            generals: new Map([[1, general('user-1', { autorunLimit: 2401 })]]),
            turnTick: '103',
        });
        expect(
            buildTurnWebPushEvents({ before, after, changes: { deletedNationSnapshots: [] } }).map(
                (event) => event.eventType
            )
        ).toEqual(['TARGET_DATE_REACHED', 'AUTONOMOUS_ACTION_ENDED']);
    });

    it('targets the users who belonged to a destroyed nation before its removal', () => {
        const before = baseline({
            generals: new Map([
                [1, general('user-1', { nationId: 7 })],
                [2, general(null, { nationId: 7 })],
                [3, general('user-3', { nationId: 7 })],
            ]),
        });
        const after = baseline({
            generals: new Map([
                [1, general('user-1', { nationId: 0 })],
                [3, general('user-3', { nationId: 0 })],
            ]),
            turnTick: '104',
        });
        const events = buildTurnWebPushEvents({
            before,
            after,
            changes: {
                deletedNationSnapshots: [
                    {
                        nation: { id: 7 },
                        generalIds: [1, 2, 3],
                        removedAt: new Date('0200-01-01T00:00:00.000Z'),
                    } as never,
                ],
            },
        });
        expect(events).toEqual([
            expect.objectContaining({ eventType: 'NATION_DESTROYED', userIds: ['user-1', 'user-3'] }),
        ]);
    });
});
