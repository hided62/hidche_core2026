import { describe, expect, it, vi } from 'vitest';

import { LiteHashDRBG, RandUtil, type TurnDaemonCommand } from '@sammo-ts/common';
import type { GamePrisma } from '@sammo-ts/infra';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import {
    buildResetStatRandomBonus,
    executeInheritanceAction,
    resolveOwnerDisplayName,
} from '../src/turn/inheritanceActionService.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

type InheritanceCommand = Extract<TurnDaemonCommand, { type: 'inheritanceAction' }>;

const buildGeneral = (overrides: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id: 1,
    userId: 'user-1',
    name: '유비',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 45, intelligence: 85 },
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24, inherit_spent_dyn: 17 },
    inheritancePoints: { previous: 10_000 },
    turnTime: new Date('0200-04-01T00:00:00.000Z'),
    ...overrides,
});

const buildWorld = (options: {
    general?: TurnGeneral;
    target?: TurnGeneral;
    worldMeta?: Record<string, unknown>;
    configConst?: Record<string, unknown>;
    configMap?: Record<string, unknown>;
}) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 200,
        currentMonth: 4,
        tickSeconds: 3_600,
        lastTurnTime: new Date('0200-04-01T00:00:00.000Z'),
        meta: { hiddenSeed: 'test-seed', season: 7, isunited: 0, ...(options.worldMeta ?? {}) },
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 200, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
            iconPath: '.',
            map: options.configMap ?? {},
            const: {
                availableSpecialWar: ['che_의술'],
                inheritBornStatPoint: 1_000,
                inheritItemRandomPoint: 3_000,
                inheritBuffPoints: [0, 200, 600, 1_200, 2_000, 3_000],
                inheritSpecificSpecialPoint: 4_000,
                inheritResetAttrPointBase: [1_000, 1_000, 2_000, 3_000],
                inheritCheckOwnerPoint: 1_000,
                ...(options.configConst ?? {}),
            },
            environment: { mapName: 'test', unitSet: 'default' },
        },
        map: { id: 'test', name: 'test', cities: [] },
        generals: [options.general ?? buildGeneral(), ...(options.target ? [options.target] : [])],
        cities: [],
        nations: [
            {
                id: 1,
                name: '촉',
                color: '#ff0000',
                capitalCityId: null,
                chiefGeneralId: 1,
                gold: 0,
                rice: 0,
                power: 0,
                level: 1,
                typeCode: 'che_def',
                meta: {},
            },
        ],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
    };
    return new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
};

const buildDatabase = (options: { point?: number; resetSeasons?: number[] } = {}) => {
    const createLog = vi.fn(async () => ({}));
    const findUserState = vi.fn(async () =>
        options.resetSeasons ? { meta: { last_stat_reset: options.resetSeasons } } : null
    );
    const upsertUserState = vi.fn(async () => ({}));
    const queryRaw = vi.fn(async () => [{ value: options.point ?? 10_000 }]);
    return {
        db: {
            $queryRaw: queryRaw,
            inheritanceLog: { create: createLog },
            inheritanceUserState: { findUnique: findUserState, upsert: upsertUserState },
        } as unknown as GamePrisma.TransactionClient,
        createLog,
        findUserState,
        upsertUserState,
        queryRaw,
    };
};

const execute = async (
    world: InMemoryTurnWorld,
    db: GamePrisma.TransactionClient,
    input: InheritanceCommand['input']
) =>
    executeInheritanceAction({
        db,
        world,
        command: { type: 'inheritanceAction', userId: 'user-1', input },
        gameNow: new Date('0200-04-01T00:00:00.000Z'),
    });

describe('inheritance action service', () => {
    it.each([
        {
            name: 'hidden buff',
            input: { action: 'buyHiddenBuff', buffType: 'warAvoidRatio', level: 1 } as const,
            cost: 200,
            general: buildGeneral(),
        },
        {
            name: 'specific special',
            input: { action: 'setNextSpecialWar', specialKey: 'che_의술' } as const,
            cost: 4_000,
            general: buildGeneral(),
        },
        {
            name: 'special reset',
            input: { action: 'resetSpecialWar' } as const,
            cost: 1_000,
            general: buildGeneral({ role: { ...buildGeneral().role, specialWar: 'che_선봉' } }),
        },
        {
            name: 'turn-time reset',
            input: { action: 'resetTurnTime' } as const,
            cost: 1_000,
            general: buildGeneral(),
        },
        {
            name: 'paid stat reset',
            input: {
                action: 'resetStat',
                leadership: 70,
                strength: 45,
                intel: 85,
                inheritBonusStat: [2, 1, 1] as [number, number, number],
            } as const,
            cost: 1_000,
            general: buildGeneral(),
        },
        {
            name: 'random unique reservation',
            input: { action: 'buyRandomUnique' } as const,
            cost: 3_000,
            general: buildGeneral(),
        },
        {
            name: 'owner lookup',
            input: { action: 'checkOwner', targetGeneralId: 2 } as const,
            cost: 1_000,
            general: buildGeneral(),
        },
    ])('charges $name in runtime rank, points, and the same dirty flush', async ({ input, cost, general }) => {
        const target =
            input.action === 'checkOwner'
                ? buildGeneral({
                      id: 2,
                      userId: 'user-2',
                      name: '조조',
                      meta: { killturn: 24, owner_name: '위유저' },
                  })
                : undefined;
        const world = buildWorld({ general, target });
        const { db, createLog } = buildDatabase();

        await expect(execute(world, db, input)).resolves.toMatchObject({ ok: true, remainPoint: 10_000 - cost });

        expect(world.getGeneralById(1)).toMatchObject({
            meta: { inherit_spent_dyn: 17 + cost },
            inheritancePoints: { previous: 10_000 - cost },
        });
        expect(world.peekDirtyState().inheritancePointAdjustments).toEqual(
            cost === 0 ? [] : [{ userId: 'user-1', key: 'previous', amount: -cost }]
        );
        expect(createLog).toHaveBeenCalled();
    });

    it('keeps free ResetStat at zero spend and uses the Ref-compatible fixed-seed bonus', async () => {
        const world = buildWorld({});
        const { db } = buildDatabase({ point: 0 });

        const result = await execute(world, db, {
            action: 'resetStat',
            leadership: 70,
            strength: 45,
            intel: 85,
            inheritBonusStat: [0, 0, 0],
        });

        expect(result).toMatchObject({ ok: true, remainPoint: 0 });
        expect(world.getGeneralById(1)?.meta.inherit_spent_dyn).toBe(17);
        expect(world.peekDirtyState().inheritancePointAdjustments).toEqual([]);
        expect(result.ok && result.stats).toEqual({ leadership: 73, strength: 45, intel: 87 });
    });

    it('matches the Ref ResetStat DRBG seed, inclusive 3..5 count, and weighted choices', () => {
        const bonus = buildResetStatRandomBonus(
            new RandUtil(new LiteHashDRBG(simpleSerialize('test-seed', 'ResetStat', 'user-1'))),
            [70, 45, 85]
        );
        expect(bonus).toEqual([3, 0, 2]);
        expect(bonus.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(3);
        expect(bonus.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(5);
    });

    it.each([1, 2])('rejects npcState=%s ResetStat exactly like Ref npc != 0', async (npcState) => {
        const world = buildWorld({ general: buildGeneral({ npcState }) });
        const { db, queryRaw } = buildDatabase();

        await expect(
            execute(world, db, {
                action: 'resetStat',
                leadership: 70,
                strength: 45,
                intel: 85,
                inheritBonusStat: [2, 1, 1],
            })
        ).resolves.toMatchObject({ ok: false, reason: 'NPC는 능력치 초기화를 할 수 없습니다.' });
        expect(queryRaw).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'purchased buff before unification',
            general: buildGeneral({ meta: { killturn: 24, inheritBuff: JSON.stringify({ warAvoidRatio: 1 }) } }),
            input: { action: 'buyHiddenBuff', buffType: 'warAvoidRatio', level: 1 } as const,
            reason: '이미 구입했습니다.',
        },
        {
            name: 'owned special before unification',
            general: buildGeneral({ role: { ...buildGeneral().role, specialWar: 'che_의술' } }),
            input: { action: 'setNextSpecialWar', specialKey: 'che_의술' } as const,
            reason: '이미 그 특기를 보유하고 있습니다.',
        },
        {
            name: 'blank special before unification',
            general: buildGeneral(),
            input: { action: 'resetSpecialWar' } as const,
            reason: '이미 전투 특기가 공란입니다.',
        },
        {
            name: 'random reservation before unification',
            general: buildGeneral({ meta: { killturn: 24, inheritRandomUnique: true } }),
            input: { action: 'buyRandomUnique' } as const,
            reason: '이미 구입 명령을 내렸습니다. 다음 턴까지 기다려주세요.',
        },
    ])('preserves Ref combined-invalid precedence: $name', async ({ general, input, reason }) => {
        const world = buildWorld({ general, worldMeta: { isunited: 1 } });
        const { db, queryRaw } = buildDatabase();

        await expect(execute(world, db, input)).resolves.toMatchObject({ ok: false, reason });
        expect(queryRaw).not.toHaveBeenCalled();
    });

    it('checks ResetStat shape, npc/S100, unification, season duplicate, then points', async () => {
        const npcWorld = buildWorld({ general: buildGeneral({ npcState: 1 }), worldMeta: { isunited: 1 } });
        const npcDb = buildDatabase({ point: 0 });
        await expect(
            execute(npcWorld, npcDb.db, {
                action: 'resetStat',
                leadership: 70,
                strength: 45,
                intel: 84,
                inheritBonusStat: [2, 1, 1],
            })
        ).resolves.toMatchObject({ ok: false, reason: '능력치 총합이 200이 아닙니다. 다시 입력해주세요!' });

        const seasonWorld = buildWorld({});
        const seasonDb = buildDatabase({ point: 0, resetSeasons: [7] });
        await expect(
            execute(seasonWorld, seasonDb.db, {
                action: 'resetStat',
                leadership: 70,
                strength: 45,
                intel: 85,
                inheritBonusStat: [2, 1, 1],
            })
        ).resolves.toMatchObject({ ok: false, reason: '이번 시즌에 이미 능력치를 초기화하셨습니다.' });
        expect(seasonDb.queryRaw).not.toHaveBeenCalled();
    });

    it('uses both unification keys and preserves owner display-name compatibility order', async () => {
        const world = buildWorld({ worldMeta: { isUnited: 1, isunited: 0 } });
        const { db } = buildDatabase();
        await expect(execute(world, db, { action: 'resetTurnTime' })).resolves.toMatchObject({
            ok: false,
            reason: '이미 천하가 통일되었습니다.',
        });

        expect(resolveOwnerDisplayName({ ownerDisplayName: '현재', owner_name: '레거시', ownerName: '호환' })).toBe(
            '현재'
        );
        expect(resolveOwnerDisplayName({ owner_name: '레거시', ownerName: '호환' })).toBe('레거시');
        expect(resolveOwnerDisplayName({ ownerName: '호환' })).toBe('호환');
        expect(resolveOwnerDisplayName({})).toBe('알수없음');
    });

    it('queues CheckOwner messages in Ref requester-then-target order', async () => {
        const world = buildWorld({
            target: buildGeneral({
                id: 2,
                userId: 'user-2',
                name: '조조',
                meta: { killturn: 24, owner_name: '위유저' },
            }),
        });
        const { db } = buildDatabase();

        await expect(execute(world, db, { action: 'checkOwner', targetGeneralId: 2 })).resolves.toMatchObject({
            ok: true,
            ownerName: '위유저',
        });
        expect(world.peekDirtyState().messages.map((message) => [message.dest.generalId, message.text])).toEqual([
            [1, '조조의 소유자는 위유저 입니다.'],
            [2, '소유자명이 누군가에 의해 확인되었습니다.'],
        ]);
    });
});
