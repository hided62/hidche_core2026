import { describe, expect, it } from 'vitest';

import type { TurnSchedule } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';
import { buildPersistedRankRows } from '../src/turn/rankData.js';

const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };

const buildGeneral = (id: number, meta: Record<string, number> = {}): TurnGeneral => ({
    id,
    name: `장수${id}`,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    turnTime: new Date('0180-01-01T00:00:00Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24, ...meta },
    penalty: {},
    officerLevel: 1,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 100,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
});

const buildWorld = (generals: TurnGeneral[]): InMemoryTurnWorld => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 180,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0180-01-01T00:00:00Z'),
        meta: {},
    };
    const snapshot: TurnWorldSnapshot = {
        generals,
        cities: [],
        nations: [],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'test' },
        },
        map: {
            id: 'test',
            name: 'test',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        },
    };
    return new InMemoryTurnWorld(state, snapshot, { schedule });
};

describe('tournament world commands', () => {
    it('updates the persisted tt rank keys for a tournament match', async () => {
        const world = buildWorld([
            buildGeneral(1, { ttg: 10, ttw: 2 }),
            buildGeneral(2, { ttg: 5, ttl: 1 }),
        ]);
        const handler = createTurnDaemonCommandHandler({ world });

        await expect(
            handler.handle({
                type: 'tournamentMatchResult',
                tournamentType: 0,
                attackerId: 1,
                defenderId: 2,
                result: 'attacker',
            })
        ).resolves.toMatchObject({ ok: true });

        expect(world.getGeneralById(1)?.meta).toMatchObject({ ttg: 11, ttw: 3 });
        expect(world.getGeneralById(2)?.meta).toMatchObject({ ttg: 5, ttl: 2 });
        expect(world.getGeneralById(1)?.meta).not.toHaveProperty('rank_ttg');
    });

    it('updates persisted betting ranks when paying a winner', async () => {
        const world = buildWorld([buildGeneral(1, { betwin: 2, betwingold: 100 })]);
        const handler = createTurnDaemonCommandHandler({ world });

        await expect(
            handler.handle({
                type: 'tournamentBettingPayout',
                bettingId: 1,
                payouts: [{ generalId: 1, amount: 500 }],
            })
        ).resolves.toMatchObject({ ok: true, totalPayout: 500 });

        expect(world.getGeneralById(1)).toMatchObject({
            gold: 1_500,
            meta: { betwin: 3, betwingold: 600 },
        });
        expect(world.getGeneralById(1)?.meta).not.toHaveProperty('rank_betwin');
    });

    it('records all four tournament types and NPC betting for at least ten generals', async () => {
        const generals = Array.from({ length: 12 }, (_, index) => buildGeneral(index + 1));
        const world = buildWorld(generals);
        const handler = createTurnDaemonCommandHandler({ world });

        for (const tournamentType of [0, 1, 2, 3] as const) {
            for (const general of generals) {
                const result = await handler.handle({
                    type: 'tournamentMatchResult',
                    tournamentType,
                    attackerId: general.id,
                    defenderId: (general.id % generals.length) + 1,
                    result: 'attacker',
                });
                expect(result).toMatchObject({ ok: true });
            }
        }
        await handler.handle({
            type: 'adjustGeneralMeta',
            reason: 'tournamentNpcBet',
            adjustments: generals.map((general) => ({
                generalId: general.id,
                metaDelta: { betgold: 1_000 },
            })),
        });
        await handler.handle({
            type: 'tournamentBettingPayout',
            bettingId: 1,
            payouts: generals.map((general) => ({ generalId: general.id, amount: 2_000 })),
        });

        for (const type of ['ttw', 'tlw', 'tsw', 'tiw', 'betgold', 'betwin', 'betwingold'] as const) {
            const positiveRows = world
                .listGenerals()
                .flatMap(buildPersistedRankRows)
                .filter((row) => row.type === type && row.value > 0);
            expect(positiveRows, type).toHaveLength(12);
        }
    });

    it('enforces a command-specific minimum remaining gold atomically', async () => {
        const world = buildWorld([buildGeneral(1)]);
        const handler = createTurnDaemonCommandHandler({ world });

        await expect(
            handler.handle({
                type: 'adjustGeneralResources',
                adjustments: [{ generalId: 1, goldDelta: -501, minGoldAfter: 500 }],
            })
        ).resolves.toMatchObject({ ok: false });
        expect(world.getGeneralById(1)?.gold).toBe(1_000);

        await expect(
            handler.handle({
                type: 'adjustGeneralResources',
                adjustments: [{ generalId: 1, goldDelta: -500, minGoldAfter: 500 }],
            })
        ).resolves.toMatchObject({ ok: true });
        expect(world.getGeneralById(1)?.gold).toBe(500);
    });
});
