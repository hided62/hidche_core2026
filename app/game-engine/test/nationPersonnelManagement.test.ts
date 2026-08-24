import { describe, expect, it } from 'vitest';

import type { TriggerValue, TurnSchedule } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';

const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };

const buildGeneral = (id: number, overrides: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id,
    userId: `user-${id}`,
    name: `장수${id}`,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    turnTime: new Date('0185-01-01T00:00:00Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 12, belong: 5, permission: 'normal' },
    penalty: {},
    officerLevel: 1,
    experience: 1_000,
    dedication: 2_000,
    injury: 0,
    gold: 1_500,
    rice: 1_600,
    crew: 100,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
    ...overrides,
});

const buildWorld = (options: {
    generals?: TurnGeneral[];
    nationMeta?: Record<string, TriggerValue>;
    cityMeta?: Record<string, TriggerValue>;
    currentYear?: number;
    scenarioConst?: Record<string, unknown>;
}) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: options.currentYear ?? 185,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0185-01-01T00:00:00Z'),
        meta: { killturn: 24, scenarioMeta: { startYear: 180 } },
    };
    const snapshot: TurnWorldSnapshot = {
        generals: options.generals ?? [
            buildGeneral(1, { officerLevel: 12 }),
            buildGeneral(2, { officerLevel: 5 }),
            buildGeneral(3),
        ],
        cities: [
            {
                id: 1,
                name: '허창',
                nationId: 1,
                level: 7,
                state: 0,
                population: 1_000,
                populationMax: 2_000,
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
                meta: options.cityMeta ?? {},
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
                meta: options.nationMeta ?? {},
            },
        ],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 65 },
            iconPath: '',
            map: {},
            const: { defaultGold: 1000, defaultRice: 1000, ...options.scenarioConst },
            environment: { mapName: 'test', unitSet: 'test' },
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
    const world = new InMemoryTurnWorld(state, snapshot, { schedule });
    return { world, handler: createTurnDaemonCommandHandler({ world }) };
};

describe('nation personnel world commands', () => {
    it('allows any unlocked head officer to appoint and preserves legacy officer state', async () => {
        const { world, handler } = buildWorld({});
        await expect(
            handler.handle({ type: 'appoint', generalId: 2, destGeneralId: 3, destCityId: 0, officerLevel: 9 })
        ).resolves.toMatchObject({ ok: true });
        expect(world.getGeneralById(3)).toMatchObject({
            officerLevel: 9,
            meta: expect.objectContaining({ officerCity: 0, officer_city: 0 }),
        });
        expect(world.getGeneralById(2)?.meta.killturn).toBe(24);
        expect(Number(world.getNationById(1)?.meta.chief_set) & (1 << 9)).toBe(1 << 9);
    });

    it('enforces actor, stat, penalty, and monthly lock boundaries without partial mutation', async () => {
        const weak = buildGeneral(3, { stats: { leadership: 70, strength: 64, intelligence: 64 } });
        const fixture = buildWorld({
            generals: [buildGeneral(1, { officerLevel: 12 }), buildGeneral(2, { officerLevel: 5 }), weak],
        });
        await expect(
            fixture.handler.handle({
                type: 'appoint',
                generalId: 3,
                destGeneralId: 2,
                destCityId: 0,
                officerLevel: 9,
            })
        ).resolves.toMatchObject({ ok: false, reason: '수뇌가 아닙니다.' });
        await expect(
            fixture.handler.handle({
                type: 'appoint',
                generalId: 2,
                destGeneralId: 3,
                destCityId: 0,
                officerLevel: 9,
            })
        ).resolves.toMatchObject({ ok: false, reason: '지력이 부족합니다.' });
        expect(fixture.world.getGeneralById(3)?.officerLevel).toBe(1);

        const locked = buildWorld({ nationMeta: { chief_set: 1 << 9 } });
        await expect(
            locked.handler.handle({
                type: 'appoint',
                generalId: 2,
                destGeneralId: 3,
                destCityId: 0,
                officerLevel: 9,
            })
        ).resolves.toMatchObject({ ok: false, reason: '지금은 임명할 수 없습니다.' });
    });

    it('appoints city officers, releases prior holders to general, and respects city locks', async () => {
        const previous = buildGeneral(4, { officerLevel: 4, meta: { killturn: 12, officerCity: 1 } });
        const fixture = buildWorld({
            generals: [
                buildGeneral(1, { officerLevel: 12 }),
                buildGeneral(2, { officerLevel: 5 }),
                buildGeneral(3),
                previous,
            ],
        });
        await expect(
            fixture.handler.handle({
                type: 'appoint',
                generalId: 2,
                destGeneralId: 3,
                destCityId: 1,
                officerLevel: 4,
            })
        ).resolves.toMatchObject({ ok: true });
        expect(fixture.world.getGeneralById(4)).toMatchObject({
            officerLevel: 1,
            meta: expect.objectContaining({ officerCity: 0 }),
        });
        expect(fixture.world.getGeneralById(3)).toMatchObject({
            officerLevel: 4,
            meta: expect.objectContaining({ officerCity: 1 }),
        });

        const locked = buildWorld({ cityMeta: { officer_set: 1 << 4 } });
        await expect(
            locked.handler.handle({
                type: 'appoint',
                generalId: 2,
                destGeneralId: 3,
                destCityId: 1,
                officerLevel: 4,
            })
        ).resolves.toMatchObject({ ok: false, reason: '이미 다른 장수가 임명되어있습니다.' });
    });

    it('replaces only eligible permission holders and rejects non-ruler or oversized requests', async () => {
        const fixture = buildWorld({
            generals: [
                buildGeneral(1, { officerLevel: 12 }),
                buildGeneral(2, { officerLevel: 5, meta: { killturn: 12, permission: 'ambassador' } }),
                buildGeneral(3),
                buildGeneral(4, { penalty: { noAmbassador: true } }),
                buildGeneral(5),
                buildGeneral(6),
            ],
        });
        await expect(
            fixture.handler.handle({
                type: 'changePermission',
                generalId: 2,
                isAmbassador: true,
                targetGeneralIds: [3],
            })
        ).resolves.toMatchObject({ ok: false, reason: '군주가 아닙니다.' });
        await expect(
            fixture.handler.handle({
                type: 'changePermission',
                generalId: 1,
                isAmbassador: true,
                targetGeneralIds: [3, 5, 6],
            })
        ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('최대 둘') });

        await expect(
            fixture.handler.handle({
                type: 'changePermission',
                generalId: 1,
                isAmbassador: true,
                targetGeneralIds: [2, 3, 4],
            })
        ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('최대 둘') });

        await expect(
            fixture.handler.handle({
                type: 'changePermission',
                generalId: 1,
                isAmbassador: true,
                targetGeneralIds: [2, 3],
            })
        ).resolves.toMatchObject({ ok: true });
        expect(fixture.world.getGeneralById(2)?.meta.permission).toBe('ambassador');
        expect(fixture.world.getGeneralById(3)?.meta.permission).toBe('ambassador');
        expect(fixture.world.getGeneralById(4)?.meta.permission).toBe('normal');
    });

    it('kicks for an unlocked head officer with resource, troop, permission, and log side effects', async () => {
        const target = buildGeneral(3, {
            troopId: 3,
            gold: 2_500,
            rice: 3_000,
            experience: 1_000,
            dedication: 2_000,
            meta: { killturn: 12, permission: 'normal', belong: 8, betray: 1 },
        });
        const member = buildGeneral(4, { troopId: 3 });
        const fixture = buildWorld({
            generals: [buildGeneral(1, { officerLevel: 12 }), buildGeneral(2, { officerLevel: 5 }), target, member],
            nationMeta: { gennum: 4 },
        });
        fixture.world.createTroop({ id: 3, nationId: 1, name: '추방대' });

        await expect(fixture.handler.handle({ type: 'kick', generalId: 2, destGeneralId: 3 })).resolves.toMatchObject({
            ok: true,
        });
        expect(fixture.world.getGeneralById(3)).toMatchObject({
            nationId: 0,
            officerLevel: 0,
            troopId: 0,
            gold: 1_000,
            rice: 1_000,
            experience: 850,
            dedication: 1_700,
            meta: expect.objectContaining({ belong: 0, permission: 'normal', betray: 2 }),
        });
        expect(fixture.world.getGeneralById(4)?.troopId).toBe(0);
        expect(fixture.world.getTroopById(3)).toBeNull();
        expect(fixture.world.getNationById(1)).toMatchObject({
            gold: 11_500,
            rice: 22_000,
            meta: expect.objectContaining({ gennum: 3 }),
        });
        expect(fixture.world.peekDirtyState().logs).toHaveLength(2);
    });

    it('rejects self, ruler, head officer, and ambassador targets without partial mutation', async () => {
        const cases = [
            { label: 'self', targetId: 2, reason: '본인은 추방할 수 없습니다.' },
            { label: 'ruler', targetId: 1, reason: '군주는 추방할 수 없습니다.' },
            { label: 'head officer', targetId: 3, reason: '수뇌는 추방할 수 없습니다.' },
            { label: 'ambassador', targetId: 4, reason: '외교권자는 추방할 수 없습니다.' },
        ] as const;

        for (const testCase of cases) {
            const fixture = buildWorld({
                generals: [
                    buildGeneral(1, { officerLevel: 12 }),
                    buildGeneral(2, { officerLevel: 5 }),
                    buildGeneral(3, { officerLevel: 7 }),
                    buildGeneral(4, {
                        meta: { killturn: 12, belong: 5, permission: 'ambassador' },
                        penalty: { noAmbassador: true },
                    }),
                    buildGeneral(5),
                ],
            });
            const originalTarget = fixture.world.getGeneralById(testCase.targetId);

            await expect(
                fixture.handler.handle({ type: 'kick', generalId: 2, destGeneralId: testCase.targetId })
            ).resolves.toMatchObject({ ok: false, reason: testCase.reason });
            expect(fixture.world.getGeneralById(testCase.targetId), testCase.label).toEqual(originalTarget);
            expect(fixture.world.getGeneralById(2)?.meta.killturn, testCase.label).toBe(12);
            expect(fixture.world.peekDirtyState().logs, testCase.label).toEqual([]);
            expect(fixture.world.peekDirtyState().nations, testCase.label).toEqual([]);
        }
    });

    it('preserves the legacy kick year boundaries and deterministic NPC public message', async () => {
        const early = buildWorld({
            currentYear: 181,
            generals: [
                buildGeneral(1, { officerLevel: 12 }),
                buildGeneral(2, { officerLevel: 5 }),
                buildGeneral(3, { meta: { killturn: 12, belong: 8, permission: 'normal', betray: 1 } }),
            ],
        });
        await early.handler.handle({ type: 'kick', generalId: 2, destGeneralId: 3 });
        expect(early.world.getGeneralById(3)).toMatchObject({
            experience: 850,
            dedication: 1_700,
            meta: expect.objectContaining({ betray: 2 }),
        });
        expect(early.world.getGeneralById(1)?.injury).toBe(1);
        expect(Number(early.world.getNationById(1)?.meta.chief_set ?? 0)).toBe(0);

        const npc = buildWorld({
            currentYear: 185,
            scenarioConst: { npcBanMessageProb: 1 },
            generals: [
                buildGeneral(1, { officerLevel: 12 }),
                buildGeneral(2, { officerLevel: 5 }),
                buildGeneral(3, { npcState: 2 }),
            ],
        });
        await npc.handler.handle({ type: 'kick', generalId: 2, destGeneralId: 3 });
        expect(npc.world.peekDirtyState().messages).toHaveLength(1);
        expect(npc.world.peekDirtyState().messages[0]).toMatchObject({
            msgType: 'public',
            src: { generalId: 3, nationId: 1 },
            dest: { generalId: 3, nationId: 1 },
        });
    });
});
