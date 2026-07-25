import { describe, expect, it } from 'vitest';
import type { TurnSchedule } from '@sammo-ts/logic';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createNationTurnMonthlyHandler } from '../src/turn/nationTurnMonthlyHandler.js';
import { LARGE_TEST_MAP, buildLargeTestCities } from './fixtures/largeTestMap.js';
import { createTurnTestHarness } from './helpers/turnTestHarness.js';

const mockDate = new Date('0189-01-01T00:00:00Z');

const createChief = (): TurnGeneral => ({
    id: 1,
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
    it('화시병 연구는 선행 11턴을 누적한 뒤 12번째 턴에만 완료한다', async () => {
        const cities = buildLargeTestCities();
        for (const city of cities) {
            city.nationId = city.id === 1 ? 1 : city.id === 2 ? 2 : 0;
        }
        const snapshot: TurnWorldSnapshot = {
            generals: [createChief()],
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
        expect(world.getGeneralById(1)!.meta.inherit_active_action).toBe(1);
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
    });

    it('월 경계마다 전략·외교 제한을 1씩 감소시키고 0 아래로 내리지 않는다', () => {
        const updates: Array<{ id: number; patch: Record<string, unknown> }> = [];
        const nations = [
            { id: 1, meta: { strategic_cmd_limit: 2, surlimit: '1', keep: true } },
            { id: 2, meta: { strategic_cmd_limit: 0, surlimit: 0 } },
        ];
        const handler = createNationTurnMonthlyHandler({
            getWorld: () =>
                ({
                    listNations: () => nations,
                    updateNation: (id: number, patch: Record<string, unknown>) => updates.push({ id, patch }),
                }) as never,
        });

        handler.onMonthChanged?.({} as never);

        expect(updates).toEqual([
            {
                id: 1,
                patch: { meta: { strategic_cmd_limit: 1, surlimit: 0, keep: true } },
            },
            {
                id: 2,
                patch: { meta: { strategic_cmd_limit: 0, surlimit: 0 } },
            },
        ]);
    });
});
