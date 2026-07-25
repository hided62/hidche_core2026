import { describe, expect, it } from 'vitest';

import type { TriggerValue, TurnSchedule } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';

const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };

const buildGeneral = (id: number, overrides: Partial<TurnGeneral> = {}): TurnGeneral => ({
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
    meta: { killturn: 24 },
    penalty: {},
    officerLevel: 1,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1000,
    rice: 1000,
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
    troops?: Array<{ id: number; nationId: number; name: string }>;
    nationMeta?: Record<string, TriggerValue>;
}) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 180,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0180-01-01T00:00:00Z'),
        meta: { killturn: 24 },
    };
    const snapshot: TurnWorldSnapshot = {
        generals: options.generals ?? [buildGeneral(1)],
        cities: [],
        nations: [
            {
                id: 1,
                name: '테스트국',
                color: '#ff0000',
                capitalCityId: null,
                chiefGeneralId: 1,
                gold: 1000,
                rice: 1000,
                power: 0,
                level: 1,
                typeCode: 'che_def',
                meta: options.nationMeta ?? {},
            },
        ],
        troops: options.troops ?? [],
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

describe('troop management world commands', () => {
    it('creates a troop and assigns the authenticated general atomically in dirty state', async () => {
        const world = buildWorld({});
        const handler = createTurnDaemonCommandHandler({ world });

        await expect(handler.handle({ type: 'troopCreate', generalId: 1, troopName: ' 백마대 ' })).resolves.toEqual({
            type: 'troopCreate',
            ok: true,
            generalId: 1,
            troopId: 1,
            troopName: '백마대',
        });
        expect(world.getGeneralById(1)?.troopId).toBe(1);
        expect(world.getTroopById(1)).toEqual({ id: 1, nationId: 1, name: '백마대' });
        expect(world.peekDirtyState().createdTroops).toEqual([{ id: 1, nationId: 1, name: '백마대' }]);

        const escapedWorld = buildWorld({ generals: [buildGeneral(2)] });
        const escapedHandler = createTurnDaemonCommandHandler({ world: escapedWorld });
        await expect(
            escapedHandler.handle({ type: 'troopCreate', generalId: 2, troopName: '<백마대>' })
        ).resolves.toMatchObject({ ok: true, troopName: '&lt;백마대&gt;' });
    });

    it('preserves legacy creation failures without mutating state', async () => {
        const assigned = buildWorld({
            generals: [buildGeneral(1, { troopId: 1 })],
            troops: [{ id: 1, nationId: 1, name: '기존대' }],
        });
        const assignedHandler = createTurnDaemonCommandHandler({ world: assigned });
        await expect(
            assignedHandler.handle({ type: 'troopCreate', generalId: 1, troopName: '신규대' })
        ).resolves.toMatchObject({ ok: false, reason: '이미 부대에 소속되어 있습니다.' });

        const blank = buildWorld({});
        const blankHandler = createTurnDaemonCommandHandler({ world: blank });
        await expect(
            blankHandler.handle({ type: 'troopCreate', generalId: 1, troopName: '   ' })
        ).resolves.toMatchObject({
            ok: false,
            reason: '부대 이름이 없습니다.',
        });
        expect(blank.getGeneralById(1)?.troopId).toBe(0);
        expect(blank.peekDirtyState().createdTroops).toEqual([]);
    });

    it('allows only the troop leader to kick a current non-leader member', async () => {
        const buildFixture = () =>
            buildWorld({
                generals: [
                    buildGeneral(1, { troopId: 1 }),
                    buildGeneral(2, { troopId: 1 }),
                    buildGeneral(3, { troopId: 1 }),
                ],
                troops: [{ id: 1, nationId: 1, name: '백마대' }],
            });

        const forbidden = buildFixture();
        const forbiddenHandler = createTurnDaemonCommandHandler({ world: forbidden });
        await expect(
            forbiddenHandler.handle({
                type: 'troopKick',
                generalId: 2,
                troopId: 1,
                targetGeneralId: 3,
            })
        ).resolves.toMatchObject({ ok: false, reason: '권한이 부족합니다.' });
        expect(forbidden.getGeneralById(3)?.troopId).toBe(1);

        const allowed = buildFixture();
        const allowedHandler = createTurnDaemonCommandHandler({ world: allowed });
        await expect(
            allowedHandler.handle({
                type: 'troopKick',
                generalId: 1,
                troopId: 1,
                targetGeneralId: 3,
            })
        ).resolves.toMatchObject({ ok: true, targetGeneralId: 3 });
        expect(allowed.getGeneralById(3)?.troopId).toBe(0);

        await expect(
            allowedHandler.handle({
                type: 'troopKick',
                generalId: 1,
                troopId: 1,
                targetGeneralId: 1,
            })
        ).resolves.toMatchObject({ ok: false, reason: '부대장을 추방할 수 없습니다.' });
    });

    it('renames for the leader or a same-nation top-secret actor and honors penalties', async () => {
        const leaderWorld = buildWorld({
            generals: [buildGeneral(1, { troopId: 1, penalty: { noTopSecret: true } })],
            troops: [{ id: 1, nationId: 1, name: '구대' }],
        });
        const leaderHandler = createTurnDaemonCommandHandler({ world: leaderWorld });
        await expect(
            leaderHandler.handle({ type: 'troopRename', generalId: 1, troopId: 1, troopName: '신대' })
        ).resolves.toMatchObject({ ok: true, troopName: '신대' });

        const managerWorld = buildWorld({
            generals: [
                buildGeneral(1, { troopId: 1 }),
                buildGeneral(2, { meta: { killturn: 24, permission: 'ambassador' } }),
            ],
            troops: [{ id: 1, nationId: 1, name: '구대' }],
        });
        const managerHandler = createTurnDaemonCommandHandler({ world: managerWorld });
        await expect(
            managerHandler.handle({ type: 'troopRename', generalId: 2, troopId: 1, troopName: '신대' })
        ).resolves.toMatchObject({ ok: true, troopName: '신대' });

        const penalizedWorld = buildWorld({
            generals: [
                buildGeneral(1, { troopId: 1 }),
                buildGeneral(2, {
                    meta: { killturn: 24, permission: 'ambassador' },
                    penalty: { noTopSecret: true },
                }),
            ],
            troops: [{ id: 1, nationId: 1, name: '구대' }],
        });
        const penalizedHandler = createTurnDaemonCommandHandler({ world: penalizedWorld });
        await expect(
            penalizedHandler.handle({ type: 'troopRename', generalId: 2, troopId: 1, troopName: '신대' })
        ).resolves.toMatchObject({ ok: false, reason: '권한이 부족합니다.' });
        expect(penalizedWorld.getTroopById(1)?.name).toBe('구대');
    });
});
