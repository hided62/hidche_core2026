import { describe, expect, it } from 'vitest';
import type { TurnSchedule } from '@sammo-ts/logic';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createNationTurnMonthlyHandler } from '../src/turn/nationTurnMonthlyHandler.js';
import { LARGE_TEST_MAP, buildLargeTestCities } from './fixtures/largeTestMap.js';
import { createTurnTestHarness } from './helpers/turnTestHarness.js';

const mockDate = new Date('0189-01-01T00:00:00Z');

const createChief = (userId: string | null): TurnGeneral => ({
    id: 1,
    userId,
    name: '군주',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 90, strength: 80, intelligence: 70 },
    turnTime: mockDate,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 800 },
    officerLevel: 12,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 100_000,
    rice: 100_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
});

describe('레거시 사령부 턴 실행 호환성', () => {
    it('피장파장은 같은 두 턴의 사기진작과 병행해도 2회째에 완료한다', async () => {
        const cities = buildLargeTestCities();
        for (const city of cities) {
            city.nationId = city.id === 1 ? 1 : city.id === 2 ? 2 : 0;
        }
        const chief = createChief('test-user');
        chief.crew = 1_000;
        chief.train = 80;
        chief.atmos = 80;
        const snapshot: TurnWorldSnapshot = {
            generals: [chief],
            cities,
            nations: [
                {
                    id: 1,
                    name: '테스트국',
                    color: '#aa0000',
                    capitalCityId: 1,
                    chiefGeneralId: 1,
                    gold: 1_000_000,
                    rice: 1_000_000,
                    power: 0,
                    level: 1,
                    typeCode: 'large_test_map_def',
                    meta: { strategic_cmd_limit: 0, gennum: 10 },
                },
                {
                    id: 2,
                    name: '상대국',
                    color: '#0000aa',
                    capitalCityId: 2,
                    chiefGeneralId: null,
                    gold: 1_000_000,
                    rice: 1_000_000,
                    power: 0,
                    level: 1,
                    typeCode: 'large_test_map_def',
                    meta: {},
                },
            ],
            troops: [],
            diplomacy: [
                { fromNationId: 1, toNationId: 2, state: 0, term: 1200, dead: 0, meta: {} },
                { fromNationId: 2, toNationId: 1, state: 0, term: 1200, dead: 0, meta: {} },
            ],
            events: [],
            initialEvents: [],
            map: LARGE_TEST_MAP,
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {
                    openingPartYear: 3,
                    develCost: 10,
                    baseGold: 1000,
                    baseRice: 1000,
                    maxResourceActionAmount: 10000,
                    maxTechLevel: 12000,
                },
                environment: { mapName: 'large_test_map', unitSet: 'default' },
            },
            scenarioMeta: { startYear: 189 } as never,
            unitSet: {} as never,
        };
        const state: TurnWorldState = {
            id: 1,
            currentYear: 189,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: mockDate,
            meta: { seed: 1 },
        };
        const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
        const resolvedActions: Array<{ kind: string; actionKey: string; completed?: boolean }> = [];
        const { world, reservedTurnStore, runOneTick } = await createTurnTestHarness({
            snapshot,
            state,
            schedule,
            map: LARGE_TEST_MAP,
            reservedTurnStoreOptions: { maxGeneralTurns: 12, maxNationTurns: 12 },
            onActionResolved: (event) => resolvedActions.push(event),
        });
        const counterStrategy = {
            action: 'che_피장파장',
            args: { destNationId: 2, commandType: 'che_허보' },
        };
        reservedTurnStore.getNationTurns(1, 12).splice(0, 2, counterStrategy, counterStrategy);
        reservedTurnStore.getGeneralTurns(1).splice(
            0,
            2,
            { action: 'che_사기진작', args: {} },
            { action: 'che_사기진작', args: {} }
        );

        await runOneTick();
        expect(world.getNationById(1)!.meta.turn_last_12).toMatchObject({
            command: '피장파장',
            term: 1,
        });
        expect(resolvedActions).toContainEqual(
            expect.objectContaining({ kind: 'nation', actionKey: 'che_피장파장', completed: false })
        );
        expect(resolvedActions).toContainEqual(
            expect.objectContaining({ kind: 'general', actionKey: 'che_사기진작', completed: true })
        );

        // PostgreSQL jsonb는 object key 순서를 보존하지 않는다. 첫 턴의
        // turn_last를 DB에 저장했다가 재적재한 상태를 그대로 재현한다.
        const nationAfterFirstTurn = world.getNationById(1)!;
        world.updateNation(1, {
            meta: {
                ...nationAfterFirstTurn.meta,
                turn_last_12: {
                    command: '피장파장',
                    arg: { commandType: 'che_허보', destNationId: 2 },
                    term: 1,
                },
            },
        });

        resolvedActions.length = 0;
        await runOneTick();
        expect(resolvedActions).toContainEqual(
            expect.objectContaining({ kind: 'nation', actionKey: 'che_피장파장', completed: true })
        );
        expect(world.getNationById(2)!.meta.next_execute_허보).toBe(189 * 12 + 1 + 60);
    });

    it.each([
        { ownerLabel: '소유 장수', userId: 'test-user', expectedActiveAction: 1 },
        { ownerLabel: '무소유 장수', userId: null, expectedActiveAction: undefined },
    ])(
        '화시병 연구는 $ownerLabel에서 12번째 턴에 완료하고 소유자에게만 능동 행동을 준다',
        async ({ userId, expectedActiveAction }) => {
            const cities = buildLargeTestCities();
            for (const city of cities) {
                city.nationId = city.id === 1 ? 1 : city.id === 2 ? 2 : 0;
            }
            const snapshot: TurnWorldSnapshot = {
                generals: [createChief(userId)],
                cities,
                nations: [
                    {
                        id: 1,
                        name: '테스트국',
                        color: '#aa0000',
                        capitalCityId: 1,
                        chiefGeneralId: 1,
                        gold: 1_000_000,
                        rice: 1_000_000,
                        power: 0,
                        level: 1,
                        typeCode: 'large_test_map_def',
                        meta: { can_화시병사용: 0 },
                    },
                    {
                        id: 2,
                        name: '상대국',
                        color: '#0000aa',
                        capitalCityId: 2,
                        chiefGeneralId: null,
                        gold: 1_000_000,
                        rice: 1_000_000,
                        power: 0,
                        level: 1,
                        typeCode: 'large_test_map_def',
                        meta: {},
                    },
                ],
                troops: [],
                diplomacy: [
                    { fromNationId: 1, toNationId: 2, state: 0, term: 1200, dead: 0, meta: {} },
                    { fromNationId: 2, toNationId: 1, state: 0, term: 1200, dead: 0, meta: {} },
                ],
                events: [],
                initialEvents: [],
                map: LARGE_TEST_MAP,
                scenarioConfig: {
                    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                    iconPath: '',
                    map: {},
                    const: {
                        openingPartYear: 3,
                        develCost: 10,
                        baseGold: 1000,
                        baseRice: 1000,
                        maxResourceActionAmount: 10000,
                        maxTechLevel: 12000,
                    },
                    environment: { mapName: 'large_test_map', unitSet: 'default' },
                },
                scenarioMeta: { startYear: 189 } as never,
                unitSet: {} as never,
            };
            const state: TurnWorldState = {
                id: 1,
                currentYear: 189,
                currentMonth: 1,
                tickSeconds: 600,
                lastTurnTime: mockDate,
                meta: { seed: 1 },
            };
            const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
            const resolvedActions: Array<{ requestedAction: string; actionKey: string; blockedReason?: string }> = [];
            const { world, reservedTurnStore, runOneTick } = await createTurnTestHarness({
                snapshot,
                state,
                schedule,
                map: LARGE_TEST_MAP,
                reservedTurnStoreOptions: { maxGeneralTurns: 12, maxNationTurns: 12 },
                onActionResolved: (event) => {
                    if (event.kind === 'nation') {
                        resolvedActions.push(event);
                    }
                },
            });
            const turns = reservedTurnStore.getNationTurns(1, 12);
            turns.fill({ action: 'event_화시병연구', args: {} });

            for (let index = 1; index <= 11; index += 1) {
                await runOneTick();
                const nation = world.getNationById(1)!;
                expect(nation.meta.can_화시병사용 ?? 0).toBe(0);
                expect(nation.meta.turn_last_12).toMatchObject({
                    command: '화시병 연구',
                    term: index,
                });
            }

            await runOneTick();
            const nation = world.getNationById(1)!;
            expect(nation.meta.can_화시병사용).toBe(1);
            expect(nation.meta.turn_last_12).toMatchObject({
                command: '화시병 연구',
                term: 0,
            });
            expect(world.getGeneralById(1)!.meta.inherit_active_action).toBe(expectedActiveAction);
            expect(world.getGeneralById(1)!.experience).toBe(60);
            expect(world.getGeneralById(1)!.dedication).toBe(60);

            reservedTurnStore.getNationTurns(1, 12)[0] = {
                action: 'che_종전제의',
                args: { destNationId: 2 },
            };
            await runOneTick();
            expect(resolvedActions.at(-1)?.blockedReason).toBeUndefined();
            expect(resolvedActions.at(-1)).toMatchObject({
                requestedAction: 'che_종전제의',
                actionKey: 'che_종전제의',
            });
            expect(world.peekDirtyState().messages).toContainEqual(
                expect.objectContaining({
                    msgType: 'diplomacy',
                    dest: expect.objectContaining({ nationId: 2 }),
                    option: { action: 'stopWar', deletable: false },
                })
            );
        }
    );

    it('MONTH action 전에 전략·외교 제한, 임시 세율, 첩보 기간을 갱신한다', async () => {
        const updates: Array<{ id: number; patch: Record<string, unknown> }> = [];
        const nations = [
            {
                id: 1,
                meta: {
                    strategic_cmd_limit: 2,
                    surlimit: '1',
                    rate: 35,
                    rate_tmp: 10,
                    spy: '{"1":1,"2":2}',
                    keep: true,
                },
            },
            { id: 2, meta: { strategic_cmd_limit: 0, surlimit: 0 } },
        ];
        const handler = createNationTurnMonthlyHandler({
            getWorld: () =>
                ({
                    listNations: () => nations,
                    updateNation: (id: number, patch: Record<string, unknown>) => updates.push({ id, patch }),
                }) as never,
        });

        await handler.beforeMonthChanged?.({} as never);

        expect(updates).toEqual([
            {
                id: 1,
                patch: {
                    meta: {
                        strategic_cmd_limit: 1,
                        surlimit: 0,
                        rate: 35,
                        rate_tmp: 35,
                        spy: { 2: 1 },
                        keep: true,
                    },
                },
            },
            {
                id: 2,
                patch: {
                    meta: {
                        strategic_cmd_limit: 0,
                        surlimit: 0,
                        rate_tmp: 20,
                        spy: {},
                    },
                },
            },
        ]);
    });

    it('첩보 도시는 실행 월부터 세 달 보이고 각 월 시작에 감소한 뒤 만료된다', async () => {
        const nation = {
            id: 1,
            meta: {
                rate: 20,
                spy: { 2: 3 },
            },
        };
        const handler = createNationTurnMonthlyHandler({
            getWorld: () =>
                ({
                    listNations: () => [nation],
                    updateNation: (_id: number, patch: { meta?: typeof nation.meta }) => {
                        if (patch.meta) nation.meta = patch.meta;
                    },
                }) as never,
        });

        expect(nation.meta.spy).toEqual({ 2: 3 });
        await handler.beforeMonthChanged?.({} as never);
        expect(nation.meta.spy).toEqual({ 2: 2 });
        await handler.beforeMonthChanged?.({} as never);
        expect(nation.meta.spy).toEqual({ 2: 1 });
        await handler.beforeMonthChanged?.({} as never);
        expect(nation.meta.spy).toEqual({});
    });
});
