import { describe, expect, it, vi } from 'vitest';
import { parseScenarioGeneralPoolCandidate, readScenarioGeneralPoolClaim, type City } from '@sammo-ts/logic';

import { loadGeneralPoolEntries } from '../src/scenario/generalPoolLoader.js';
import { loadScenarioDefinitionById } from '../src/scenario/scenarioLoader.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createCreateManyNpcHandler } from '../src/turn/monthlyCreateManyNpcAction.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnGeneralPoolEntry, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const turnTime = new Date('0180-12-01T00:00:00.000Z');

const city: City = {
    id: 1,
    name: '테스트성',
    nationId: 0,
    level: 4,
    state: 0,
    population: 10_000,
    populationMax: 20_000,
    agriculture: 1_000,
    agricultureMax: 2_000,
    commerce: 1_000,
    commerceMax: 2_000,
    security: 1_000,
    securityMax: 2_000,
    supplyState: 1,
    frontState: 0,
    defence: 1_000,
    defenceMax: 2_000,
    wall: 1_000,
    wallMax: 2_000,
    meta: {},
};

describe('scenario 903 general-pool composition', () => {
    it('feeds the tracked U30 pool into the first 100-NPC event without losing candidate fields', async () => {
        const [scenario, seeds] = await Promise.all([
            loadScenarioDefinitionById(903),
            loadGeneralPoolEntries('SPoolUnderU30'),
        ]);
        expect(scenario.config.map.targetGeneralPool).toBe('SPoolUnderU30');
        const createEvent = scenario.events.find(
            (event): event is unknown[] =>
                Array.isArray(event) &&
                event[0] === 'month' &&
                event.some((action) => Array.isArray(action) && action[0] === 'CreateManyNPC')
        );
        expect(createEvent).toEqual([
            'month',
            1_000,
            ['Date', '==', null, 12],
            ['CreateManyNPC', 100, 0],
            ['DeleteEvent'],
        ]);
        const createAction = createEvent?.find(
            (action): action is unknown[] => Array.isArray(action) && action[0] === 'CreateManyNPC'
        );
        expect(createAction).toBeDefined();

        const generalPoolEntries: TurnGeneralPoolEntry[] = seeds.map((seed, index) => ({
            id: index + 1,
            uniqueName: seed.uniqueName,
            ownerUserId: null,
            generalId: null,
            reservedUntil: null,
            reservedUntilTick: null,
            candidate: parseScenarioGeneralPoolCandidate({ id: index + 1, ...seed }),
        }));
        const map = {
            id: 'scenario-903-pool-composition',
            name: 'scenario 903 pool composition',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        };
        const state: TurnWorldState = {
            id: 1,
            currentYear: 180,
            currentMonth: 12,
            tickSeconds: 600,
            lastTurnTime: turnTime,
            meta: { hiddenSeed: 'scenario-903-pool-composition' },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: scenario.config,
            scenarioMeta: {
                title: scenario.title,
                startYear: scenario.startYear,
                life: scenario.life,
                fiction: scenario.fiction,
                history: scenario.history,
                ignoreDefaultEvents: scenario.ignoreDefaultEvents,
            },
            map,
            unitSet: { id: 'test', name: 'test', crewTypes: [] },
            generals: [],
            cities: [city],
            nations: [],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            generalPoolEntries,
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        const reservedTurns = new InMemoryReservedTurnStore(
            {
                generalTurn: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
                nationTurn: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
            } as never,
            { maxGeneralTurns: 30, maxNationTurns: 12 }
        );
        const handler = createCreateManyNpcHandler({
            getWorld: () => world,
            reservedTurns,
            env: buildCommandEnv(scenario.config),
        });

        await handler(
            createAction!.slice(1),
            {
                year: 180,
                month: 12,
                startyear: 180,
                currentEventID: 1,
                turnTime,
            },
            {
                id: 1,
                targetCode: 'month',
                priority: 1_000,
                condition: true,
                action: [],
                meta: {},
            }
        );

        const candidatesById = new Map(generalPoolEntries.map((entry) => [entry.id, entry.candidate]));
        const created = world.peekDirtyState().createdGenerals;
        expect(created).toHaveLength(100);
        const claims = created.map((general) => readScenarioGeneralPoolClaim(general.meta));
        expect(new Set(claims.map((claim) => claim?.poolEntryId)).size).toBe(100);
        for (const [index, general] of created.entries()) {
            const claim = claims[index];
            expect(claim).not.toBeNull();
            const candidate = candidatesById.get(claim!.poolEntryId)!;
            expect(general).toMatchObject({
                name: `ⓜ${candidate.name}`,
                stats: candidate.stats,
                picture: candidate.picture,
                imageServer: candidate.imageServer,
                role: { specialDomestic: candidate.specialDomestic },
                meta: {
                    dex1: candidate.dex?.[0],
                    dex2: candidate.dex?.[1],
                    dex3: candidate.dex?.[2],
                    dex4: candidate.dex?.[3],
                    dex5: candidate.dex?.[4],
                },
            });
        }
    });
});
