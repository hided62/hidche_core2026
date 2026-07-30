import { describe, expect, it } from 'vitest';

import type { ScenarioEffectKey, TurnSchedule } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';

const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };

const buildGeneral = (overrides: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id: 7,
    userId: 'user-7',
    name: '테스트장수',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 60, intelligence: 50 },
    turnTime: new Date('0185-01-01T00:00:00Z'),
    recentWarTime: null,
    role: {
        items: { horse: 'che_명마', weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: {
        killturn: 12,
        myset: 3,
        defence_train: 80,
        tnmt: 0,
        use_treatment: 10,
        use_auto_nation_turn: 1,
    },
    penalty: {},
    officerLevel: 1,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 100,
    crewTypeId: 0,
    train: 90,
    atmos: 90,
    age: 20,
    npcState: 0,
    ...overrides,
});

const buildWorld = (
    general = buildGeneral(),
    options: { autorunLimit?: boolean; scenarioEffect?: ScenarioEffectKey | null } = {}
) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 185,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0185-01-01T00:00:00Z'),
        meta: {
            killturn: 24,
            autorun_user: options.autorunLimit ? { limit_minutes: 60 } : {},
        },
    };
    const snapshot: TurnWorldSnapshot = {
        generals: [general],
        cities: [],
        nations: [],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 65 },
            iconPath: '',
            map: {},
            const: { maxTrainByWar: 100, maxAtmosByWar: 100 },
            environment: {
                mapName: 'test',
                unitSet: 'test',
                ...(options.scenarioEffect !== undefined ? { scenarioEffect: options.scenarioEffect } : {}),
            },
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

describe('my information world commands', () => {
    it('normalizes legacy settings and charges myset only when defence mode changes', async () => {
        const fixture = buildWorld();

        await expect(
            fixture.handler.handle({
                type: 'setMySetting',
                generalId: 7,
                settings: {
                    tnmt: 9,
                    defence_train: 94,
                    use_treatment: 200,
                    use_auto_nation_turn: 0,
                },
            })
        ).resolves.toMatchObject({ ok: true });

        expect(fixture.world.getGeneralById(7)).toMatchObject({
            train: 87,
            atmos: 84,
            meta: {
                tnmt: 1,
                defence_train: 999,
                use_treatment: 100,
                use_auto_nation_turn: 0,
                myset: 2,
            },
        });

        await fixture.handler.handle({
            type: 'setMySetting',
            generalId: 7,
            settings: { tnmt: 0, defence_train: 999, use_treatment: 1 },
        });
        expect(fixture.world.getGeneralById(7)?.meta).toMatchObject({
            tnmt: 0,
            use_treatment: 10,
            myset: 2,
        });
    });

    it.each([
        'event_UnlimitedDefenceThresholdChange',
        'event_StrongAttacker',
        'event_MoreEffect',
    ] satisfies ScenarioEffectKey[])(
        'preserves the %s scenario that waives the no-defence penalty',
        async (scenarioEffect) => {
            const fixture = buildWorld(buildGeneral(), { scenarioEffect });
            await fixture.handler.handle({
                type: 'setMySetting',
                generalId: 7,
                settings: { defence_train: 999 },
            });
            expect(fixture.world.getGeneralById(7)).toMatchObject({ train: 90, atmos: 90 });
        }
    );

    it('applies vacation killturn and rejects it in automatic-turn mode', async () => {
        const allowed = buildWorld();
        await expect(allowed.handler.handle({ type: 'vacation', generalId: 7 })).resolves.toMatchObject({ ok: true });
        expect(allowed.world.getGeneralById(7)?.meta.killturn).toBe(72);

        const blocked = buildWorld(buildGeneral(), { autorunLimit: true });
        await expect(blocked.handler.handle({ type: 'vacation', generalId: 7 })).resolves.toMatchObject({
            ok: false,
            reason: '자동 턴인 경우에는 휴가 명령이 불가능합니다.',
        });
        expect(blocked.world.getGeneralById(7)?.meta.killturn).toBe(12);
    });

    it('drops only the authenticated command target slot and rejects an empty slot', async () => {
        const fixture = buildWorld();
        await expect(
            fixture.handler.handle({ type: 'dropItem', generalId: 7, itemType: 'weapon' })
        ).resolves.toMatchObject({ ok: false });
        await expect(
            fixture.handler.handle({ type: 'dropItem', generalId: 7, itemType: 'horse' })
        ).resolves.toMatchObject({ ok: true });
        expect(fixture.world.getGeneralById(7)?.role.items.horse).toBeNull();
    });
});
