import { describe, expect, it, vi } from 'vitest';

import type { GamePrisma } from '@sammo-ts/infra';
import type { City, Nation } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { persistUnificationFinalization } from '../src/turn/unificationPersistence.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildWorld = (): InMemoryTurnWorld => {
    const turnTime = new Date('0190-07-01T00:00:00.000Z');
    const general: TurnGeneral = {
        id: 1,
        userId: 'user-1',
        name: '통일장수',
        nationId: 1,
        cityId: 1,
        troopId: 0,
        stats: { leadership: 80, strength: 70, intelligence: 60 },
        turnTime,
        role: {
            items: { horse: null, weapon: null, book: null, item: null },
            personality: null,
            specialDomestic: null,
            specialWar: null,
        },
        triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
        meta: {
            killturn: 24,
            owner_name: '표시 이름',
            inherit_lived_month: 10,
            max_domestic_critical: 20,
            inherit_active_action: 3,
            rank_warnum: 4,
            firenum: 2,
            dex1: 100,
        },
        officerLevel: 12,
        experience: 10,
        dedication: 5,
        injury: 0,
        gold: 100,
        rice: 100,
        crew: 100,
        crewTypeId: 0,
        train: 0,
        atmos: 0,
        age: 40,
        npcState: 0,
        picture: '1.png',
        imageServer: 0,
    };
    const nation: Nation = {
        id: 1,
        name: '통일국',
        color: '#ffffff',
        capitalCityId: 1,
        chiefGeneralId: 1,
        gold: 1000,
        rice: 2000,
        power: 3000,
        level: 1,
        typeCode: 'test',
        meta: {},
    };
    const city: City = {
        id: 1,
        name: '통일도시',
        nationId: 1,
        level: 1,
        state: 0,
        population: 1000,
        populationMax: 2000,
        agriculture: 0,
        agricultureMax: 0,
        commerce: 0,
        commerceMax: 0,
        security: 0,
        securityMax: 0,
        supplyState: 1,
        frontState: 0,
        defence: 0,
        defenceMax: 0,
        wall: 0,
        wallMax: 0,
        meta: {},
    };
    const state: TurnWorldState = {
        id: 1,
        currentYear: 190,
        currentMonth: 7,
        tickSeconds: 600,
        lastTurnTime: turnTime,
        meta: {
            killturn: 24,
            serverId: 'server-1',
            serverName: '테스트',
            season: 1,
            scenarioId: 2,
            scenarioMeta: { title: '테스트 시나리오' },
        },
    };
    const snapshot: TurnWorldSnapshot = {
        generals: [general],
        cities: [city],
        nations: [nation],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: { minPushHallAge: 30 },
            environment: { mapName: 'test', unitSet: 'test' },
        },
        map: {
            id: 'test',
            name: 'test',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        },
    };
    return new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
};

const input = {
    generationKey: 'unification:server-1',
    serverId: 'server-1',
    profileName: 'che',
    winnerNationId: 1,
    year: 190,
    month: 7,
    completedAt: new Date('0190-07-01T00:00:00.000Z'),
} as const;

describe('persistUnificationFinalization', () => {
    it('does not write when the transaction-scoped generation was already applied', async () => {
        const transaction = Object.assign({} as GamePrisma.TransactionClient, {
            $executeRaw: vi.fn().mockResolvedValue(1),
            unificationFinalization: {
                findUnique: vi.fn().mockResolvedValue({
                    generationKey: input.generationKey,
                    serverId: input.serverId,
                    profileName: input.profileName,
                    winnerNation: input.winnerNationId,
                    year: input.year,
                    month: input.month,
                    completedAt: input.completedAt,
                }),
                create: vi.fn(),
            },
        });

        await expect(persistUnificationFinalization(transaction, input, buildWorld())).resolves.toEqual({
            status: 'ALREADY_APPLIED',
            generationKey: input.generationKey,
        });
        expect(transaction.unificationFinalization.create).not.toHaveBeenCalled();
    });

    it('uses one supplied transaction for absolute inheritance and archive writes', async () => {
        const inheritanceUpsert = vi.fn().mockResolvedValue({});
        const inheritanceResultCreate = vi.fn().mockResolvedValue({});
        const inheritanceLogCreate = vi.fn().mockResolvedValue({});
        const hallCreate = vi.fn().mockResolvedValue({});
        const gameHistoryUpdate = vi.fn().mockResolvedValue({});
        const emperorCreate = vi.fn().mockResolvedValue({});
        const transaction = Object.assign({} as GamePrisma.TransactionClient, {
            $executeRaw: vi.fn().mockResolvedValue(1),
            unificationFinalization: {
                findUnique: vi.fn().mockResolvedValue(null),
                create: vi.fn().mockResolvedValue({}),
            },
            inheritancePoint: {
                findMany: vi.fn().mockResolvedValue([
                    { userId: 'user-1', key: 'previous', value: 100 },
                    { userId: 'user-1', key: 'unifier', value: 7 },
                ]),
                upsert: inheritanceUpsert,
                deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            inheritanceResult: { create: inheritanceResultCreate },
            inheritanceLog: { create: inheritanceLogCreate },
            rankData: { findMany: vi.fn().mockResolvedValue([]) },
            gameHistory: { count: vi.fn().mockResolvedValue(1), update: gameHistoryUpdate },
            hallOfFame: {
                findFirst: vi.fn().mockResolvedValue(null),
                create: hallCreate,
                update: vi.fn().mockResolvedValue({}),
            },
            logEntry: { findMany: vi.fn().mockResolvedValue([]) },
            oldNation: {
                upsert: vi.fn().mockResolvedValue({}),
                findMany: vi.fn().mockResolvedValue([]),
            },
            oldGeneral: { upsert: vi.fn().mockResolvedValue({}) },
            emperor: { create: emperorCreate },
        });
        await expect(persistUnificationFinalization(transaction, input, buildWorld())).resolves.toEqual({
            status: 'APPLIED',
            generationKey: input.generationKey,
        });

        expect(inheritanceUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                update: { value: 2206 },
                create: { userId: 'user-1', key: 'previous', value: 2206 },
            })
        );
        expect(inheritanceResultCreate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ serverId: 'server-1' }) })
        );
        expect(inheritanceLogCreate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ serverId: 'server-1' }) })
        );
        expect(hallCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    aux: expect.objectContaining({ ownerDisplayName: '표시 이름', fgColor: '#000000' }),
                }),
            })
        );
        expect(gameHistoryUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ winnerNation: 1 }) })
        );
        expect(emperorCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ aux: { winnerNationId: 1, generationKey: input.generationKey } }),
            })
        );
    });
});
