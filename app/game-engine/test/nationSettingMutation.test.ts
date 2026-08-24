import { describe, expect, it } from 'vitest';

import type { TurnDaemonCommand } from '@sammo-ts/common';
import type { TurnSchedule } from '@sammo-ts/logic';

import { normalizeTurnDaemonCommand } from '../src/turn/commandRegistry.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { applyNationSettingMutation } from '../src/turn/nationSettingMutation.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

type SetNationSettingCommand = Extract<TurnDaemonCommand, { type: 'setNationSetting' }>;
type NationSettingMutation = SetNationSettingCommand['mutation'];

const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
const acceptedAt = new Date('2026-02-03T04:05:06.000Z');

const general: TurnGeneral = {
    id: 1,
    userId: 'owner-1',
    name: '테스트군주',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 75, strength: 40, intelligence: 70 },
    turnTime: new Date('0185-01-01T00:00:00.000Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    penalty: {},
    officerLevel: 12,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 1100,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
};

const snapshot: TurnWorldSnapshot = {
    generals: [general],
    cities: [
        {
            id: 1,
            name: '허창',
            nationId: 1,
            level: 7,
            state: 0,
            population: 100_000,
            populationMax: 200_000,
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
        },
    ],
    nations: [
        {
            id: 1,
            name: '위',
            color: '#777777',
            capitalCityId: 1,
            chiefGeneralId: 1,
            gold: 10_000,
            rice: 20_000,
            power: 0,
            level: 3,
            typeCode: 'che_법가',
            meta: { tech: 3_000, preserved: 'yes' },
        },
    ],
    troops: [],
    diplomacy: [],
    events: [],
    initialEvents: [],
    scenarioConfig: {
        stat: { total: 300, min: 10, max: 80, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 65 },
        iconPath: '',
        map: {},
        const: {},
        environment: { mapName: 'test', unitSet: 'basic' },
    },
    scenarioMeta: {
        title: 'test',
        startYear: 180,
        life: null,
        fiction: null,
        history: [],
        ignoreDefaultEvents: false,
    },
    map: {
        id: 'test',
        name: 'test',
        cities: [],
        defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
    },
};

const state: TurnWorldState = {
    id: 1,
    currentYear: 185,
    currentMonth: 1,
    tickSeconds: 600,
    lastTurnTime: new Date('0185-01-01T00:00:00.000Z'),
    clockBaseTime: new Date('0185-01-01T00:00:00.000Z'),
    clockTick: 0,
    clockMode: 'manual',
    clockWallAnchor: new Date('2026-01-01T00:00:00.000Z'),
    lastTurnTick: 0,
    meta: { killturn: 24 },
};

const createWorld = (options?: {
    general?: Partial<TurnGeneral>;
    nationMeta?: TurnWorldSnapshot['nations'][number]['meta'];
    worldMeta?: Record<string, unknown>;
}): InMemoryTurnWorld => {
    const nextSnapshot = structuredClone(snapshot);
    nextSnapshot.generals[0] = { ...nextSnapshot.generals[0]!, ...options?.general };
    nextSnapshot.nations[0]!.meta = {
        ...nextSnapshot.nations[0]!.meta,
        ...options?.nationMeta,
    };
    return new InMemoryTurnWorld(
        {
            ...state,
            meta: { ...state.meta, ...options?.worldMeta },
        },
        nextSnapshot,
        { schedule }
    );
};

const command = (
    mutation: NationSettingMutation,
    overrides?: Partial<Omit<SetNationSettingCommand, 'type' | 'mutation'>>
): SetNationSettingCommand => ({
    type: 'setNationSetting',
    requestId: 'nation-setting-test',
    userId: 'owner-1',
    generalId: 1,
    nationId: 1,
    mutation,
    ...overrides,
});

describe('nation setting mutation', () => {
    it('keeps raw required validation at the API boundary and only enforces code-point length durably', () => {
        const normalizeNotice = (message: string) =>
            normalizeTurnDaemonCommand({
                requestId: 'nation-setting-text-boundary',
                sentAt: acceptedAt.toISOString(),
                command: command({ kind: 'notice', message }),
            });

        expect(normalizeNotice('')).toMatchObject({
            type: 'setNationSetting',
            mutation: { kind: 'notice', message: '' },
        });
        expect(normalizeNotice(' \t\n\v\0')).toMatchObject({
            type: 'setNationSetting',
            mutation: { kind: 'notice', message: ' \t\n\v\0' },
        });
        expect(normalizeNotice('　')).toMatchObject({
            type: 'setNationSetting',
            mutation: { kind: 'notice', message: '　' },
        });
        expect(normalizeNotice('😀'.repeat(16_384))).not.toBeNull();
        expect(normalizeNotice('😀'.repeat(16_385))).toBeNull();
        expect(
            normalizeTurnDaemonCommand({
                requestId: 'nation-setting-scout-text-boundary',
                sentAt: acceptedAt.toISOString(),
                command: command({ kind: 'scoutMessage', message: '😀'.repeat(1_000) }),
            })
        ).not.toBeNull();
        expect(
            normalizeTurnDaemonCommand({
                requestId: 'nation-setting-scout-text-overflow',
                sentAt: acceptedAt.toISOString(),
                command: command({ kind: 'scoutMessage', message: '😀'.repeat(1_001) }),
            })
        ).toBeNull();
    });

    it.each([
        ['notice', 'notice', 'nationNotice'],
        ['scoutMessage', 'infoText', null],
    ] as const)('stores an empty sanitized %s string like Ref', (kind, metaKey, structuredMetaKey) => {
        const normalized = normalizeTurnDaemonCommand({
            requestId: `nation-setting-empty-${kind}`,
            sentAt: acceptedAt.toISOString(),
            command: command({ kind, message: '' }),
        });
        expect(normalized).not.toBeNull();
        if (!normalized || normalized.type !== 'setNationSetting') {
            throw new Error('setNationSetting normalization failed');
        }

        const world = createWorld();
        expect(applyNationSettingMutation({ world, command: normalized, acceptedAt })).toMatchObject({
            type: 'setNationSetting',
            ok: true,
        });
        expect(world.getNationById(1)?.meta[metaKey]).toBe('');
        if (structuredMetaKey) {
            expect(world.getNationById(1)?.meta[structuredMetaKey]).toMatchObject({ msg: '' });
        }
    });

    it('rechecks owner, nation, and permission at execution time without mutating nation metadata on rejection', () => {
        const cases: Array<{
            name: string;
            world: InMemoryTurnWorld;
            command: SetNationSettingCommand;
            code: 'FORBIDDEN' | 'PRECONDITION_FAILED';
        }> = [
            {
                name: 'owner changed',
                world: createWorld(),
                command: command({ kind: 'rate', amount: 20 }, { userId: 'other-owner' }),
                code: 'FORBIDDEN',
            },
            {
                name: 'nation changed',
                world: createWorld({ general: { nationId: 2 } }),
                command: command({ kind: 'rate', amount: 20 }),
                code: 'PRECONDITION_FAILED',
            },
            {
                name: 'permission revoked',
                world: createWorld({ general: { officerLevel: 2 } }),
                command: command({ kind: 'rate', amount: 20 }),
                code: 'FORBIDDEN',
            },
        ];

        for (const testCase of cases) {
            const before = structuredClone(testCase.world.getNationById(1)?.meta);
            expect(
                applyNationSettingMutation({
                    world: testCase.world,
                    command: testCase.command,
                    acceptedAt,
                }),
                testCase.name
            ).toMatchObject({ type: 'setNationSetting', ok: false, code: testCase.code });
            expect(testCase.world.getNationById(1)?.meta, testCase.name).toEqual(before);
        }
    });

    it('preserves the special editable-permission rules for high officers and low ambassadors', () => {
        const highOfficer = createWorld({
            general: { officerLevel: 5, penalty: { noChief: true } },
        });
        expect(
            applyNationSettingMutation({
                world: highOfficer,
                command: command({ kind: 'rate', amount: 20 }, { requestId: 'high-officer' }),
                acceptedAt,
            })
        ).toMatchObject({ type: 'setNationSetting', ok: true });
        expect(highOfficer.getNationById(1)?.meta).toMatchObject({ rate: 20, preserved: 'yes' });

        const lowAmbassador = createWorld({
            general: { officerLevel: 2, meta: { killturn: 24, permission: 'ambassador' } },
        });
        expect(
            applyNationSettingMutation({
                world: lowAmbassador,
                command: command({ kind: 'bill', amount: 100 }, { requestId: 'low-ambassador' }),
                acceptedAt,
            })
        ).toMatchObject({ type: 'setNationSetting', ok: true });
        expect(lowAmbassador.getNationById(1)?.meta).toMatchObject({ bill: 100, preserved: 'yes' });
    });

    it('stores the notice text and author snapshot at logical game time', () => {
        const world = createWorld();
        const result = applyNationSettingMutation({
            world,
            command: command({ kind: 'notice', message: '새 국가 방침' }, { requestId: 'notice-logical-time' }),
            acceptedAt,
        });

        expect(result).toMatchObject({
            type: 'setNationSetting',
            ok: true,
            nationId: 1,
            updatedAt: expect.stringMatching(/^2026-02-03T04:05:06\.000Z#[0-9a-f]{16}$/),
        });
        expect(world.getNationById(1)?.meta).toMatchObject({
            preserved: 'yes',
            notice: '새 국가 방침',
            nationNotice: {
                date: '0185-01-01 09:00:00',
                msg: '새 국가 방침',
                author: '테스트군주',
                authorID: 1,
            },
            _updatedAt: expect.stringMatching(/^2026-02-03T04:05:06\.000Z#[0-9a-f]{16}$/),
        });
    });

    it('treats an absent war-setting counter as zero and leaves metadata unchanged', () => {
        const world = createWorld();
        const before = structuredClone(world.getNationById(1)?.meta);

        expect(
            applyNationSettingMutation({
                world,
                command: command({ kind: 'blockWar', value: true }),
                acceptedAt,
            })
        ).toEqual({
            type: 'setNationSetting',
            ok: false,
            code: 'BAD_REQUEST',
            reason: '잔여 횟수가 부족합니다.',
            nationId: 1,
        });
        expect(world.getNationById(1)?.meta).toEqual(before);
    });

    it('consumes the current war-setting counter sequentially and rejects after exhaustion', () => {
        const world = createWorld({ nationMeta: { available_war_setting_cnt: 2 } });

        expect(
            applyNationSettingMutation({
                world,
                command: command({ kind: 'blockWar', value: true }, { requestId: 'block-war-1' }),
                acceptedAt,
            })
        ).toMatchObject({ type: 'setNationSetting', ok: true, availableCnt: 1 });
        expect(world.getNationById(1)?.meta).toMatchObject({ war: 1, available_war_setting_cnt: 1 });

        expect(
            applyNationSettingMutation({
                world,
                command: command({ kind: 'blockWar', value: false }, { requestId: 'block-war-2' }),
                acceptedAt,
            })
        ).toMatchObject({ type: 'setNationSetting', ok: true, availableCnt: 0 });
        expect(world.getNationById(1)?.meta).toMatchObject({ war: 0, available_war_setting_cnt: 0 });

        const beforeRejected = structuredClone(world.getNationById(1)?.meta);
        expect(
            applyNationSettingMutation({
                world,
                command: command({ kind: 'blockWar', value: true }, { requestId: 'block-war-3' }),
                acceptedAt,
            })
        ).toMatchObject({ type: 'setNationSetting', ok: false, code: 'BAD_REQUEST' });
        expect(world.getNationById(1)?.meta).toEqual(beforeRejected);
    });

    it.each([
        ['missing', undefined],
        ['null', null],
        ['false', false],
        ['zero', 0],
        ['empty string', ''],
        ['string zero', '0'],
        ['empty array', []],
    ])('allows scout changes when the legacy lock value is falsey: %s', (_name, lockValue) => {
        const world = createWorld({
            worldMeta: lockValue === undefined ? {} : { block_change_scout: lockValue },
        });

        expect(
            applyNationSettingMutation({
                world,
                command: command({ kind: 'blockScout', value: true }),
                acceptedAt,
            })
        ).toMatchObject({ type: 'setNationSetting', ok: true });
        expect(world.getNationById(1)?.meta).toMatchObject({ scout: 1, preserved: 'yes' });
    });

    it.each([
        ['true', true],
        ['one', 1],
        ['string one', '1'],
        ['non-empty array', [0]],
        ['object', {}],
    ])('rejects scout changes without mutation when the legacy lock value is truthy: %s', (_name, lockValue) => {
        const world = createWorld({ worldMeta: { block_change_scout: lockValue } });
        const before = structuredClone(world.getNationById(1)?.meta);

        expect(
            applyNationSettingMutation({
                world,
                command: command({ kind: 'blockScout', value: true }),
                acceptedAt,
            })
        ).toEqual({
            type: 'setNationSetting',
            ok: false,
            code: 'FORBIDDEN',
            reason: '임관 설정을 바꿀 수 없도록 설정되어 있습니다.',
            nationId: 1,
        });
        expect(world.getNationById(1)?.meta).toEqual(before);
    });
});
