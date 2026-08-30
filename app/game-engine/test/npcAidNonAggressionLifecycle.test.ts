import { describe, expect, it } from 'vitest';
import { GAME_TICKS_PER_TURN } from '@sammo-ts/common';
import { DIPLOMACY_STATE, type TriggerValue, type TurnSchedule } from '@sammo-ts/logic';

import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createMonthlyDiplomacyHandler } from '../src/turn/monthlyNationStatsHandler.js';
import { LARGE_TEST_MAP, buildLargeTestCities } from './fixtures/largeTestMap.js';
import { createTurnTestHarness } from './helpers/turnTestHarness.js';

const mockDate = new Date('0190-01-01T00:00:00.000Z');
const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };

const createChief = (npcState: number, userId: string | null): TurnGeneral => ({
    id: 1,
    userId,
    name: npcState >= 2 ? 'NPC군주' : '유저군주',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 90, strength: 80, intelligence: 70 },
    turnTime: mockDate,
    turnTick: 0,
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
    npcState,
});

const createFixture = (options: { npcState: number; nationMeta?: Record<string, TriggerValue>; term?: number }) => {
    const cities = buildLargeTestCities();
    for (const city of cities) {
        city.nationId = city.id === 1 ? 1 : city.id === 2 ? 2 : 0;
        if (city.id === 1 || city.id === 2) {
            city.supplyState = 1;
        }
    }
    const diplomacyState = options.term === undefined ? DIPLOMACY_STATE.TRADE : DIPLOMACY_STATE.NON_AGGRESSION;
    const diplomacyTerm = options.term ?? 0;
    const snapshot: TurnWorldSnapshot = {
        generals: [createChief(options.npcState, options.npcState >= 2 ? null : 'user-1')],
        cities,
        nations: [
            {
                id: 1,
                name: '제안국',
                color: '#aa0000',
                capitalCityId: 1,
                chiefGeneralId: 1,
                gold: 1_000_000,
                rice: 1_000_000,
                power: 0,
                level: 1,
                typeCode: 'large_test_map_def',
                meta: options.nationMeta ?? {},
            },
            {
                id: 2,
                name: '원조국',
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
            { fromNationId: 1, toNationId: 2, state: diplomacyState, term: diplomacyTerm, dead: 0, meta: {} },
            { fromNationId: 2, toNationId: 1, state: diplomacyState, term: diplomacyTerm, dead: 0, meta: {} },
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
                maxResourceActionAmount: 10_000,
                maxTechLevel: 12_000,
            },
            environment: { mapName: 'large_test_map', unitSet: 'default' },
        },
        scenarioMeta: { startYear: 180 } as never,
        unitSet: {} as never,
    };
    const state: TurnWorldState = {
        id: 1,
        currentYear: 190,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: mockDate,
        clockBaseTime: mockDate,
        clockTick: 0,
        lastTurnTick: 0,
        meta: { seed: 1 },
    };
    return { snapshot, state };
};

describe('NPC 원조 기반 불가침 제의 lifecycle', () => {
    it('persists the exact message expiry and does not propose again while the previous letter is valid', async () => {
        const fixture = createFixture({
            npcState: 2,
            nationMeta: {
                recv_assist: { n2: [2, 1_000_000] },
                npc_nation_policy: { priority: ['불가침제의'] },
            },
        });
        const { world, runOneTick } = await createTurnTestHarness({
            ...fixture,
            schedule,
            map: LARGE_TEST_MAP,
            reservedTurnStoreOptions: { maxGeneralTurns: 12, maxNationTurns: 12 },
        });

        await runOneTick();

        const firstMessages = world
            .peekDirtyState()
            .messages.filter((message) => message.msgType === 'diplomacy' && message.option?.action === 'noAggression');
        expect(firstMessages).toHaveLength(1);
        expect(firstMessages[0]?.option).toMatchObject({ year: 210, month: 12 });
        const tryEntry = (world.getNationById(1)!.meta.resp_assist_try as Record<string, number[]>).n2!;
        expect(tryEntry).toHaveLength(3);
        const validUntilTick = tryEntry[2]!;
        expect(validUntilTick - world.dateToGameTick(firstMessages[0]!.time)).toBe(GAME_TICKS_PER_TURN * 3);
        expect(world.dateToGameTick(firstMessages[0]!.validUntil)).toBe(validUntilTick);

        await runOneTick();
        await runOneTick();
        expect(
            world
                .peekDirtyState()
                .messages.filter(
                    (message) => message.msgType === 'diplomacy' && message.option?.action === 'noAggression'
                )
        ).toHaveLength(1);

        await runOneTick();
        expect(
            world
                .peekDirtyState()
                .messages.filter(
                    (message) => message.msgType === 'diplomacy' && message.option?.action === 'noAggression'
                )
        ).toHaveLength(2);
    });

    it('never proposes again to a nation that rejected the aid-based proposal', async () => {
        const fixture = createFixture({
            npcState: 2,
            nationMeta: {
                recv_assist: { n2: [2, 1_000_000] },
                resp_assist_try: { n2: [2, 2280, 0] },
                resp_assist_declined: { n2: [2, 2280] },
                npc_nation_policy: { priority: ['불가침제의'] },
            },
        });
        const { world, runOneTick } = await createTurnTestHarness({
            ...fixture,
            schedule,
            map: LARGE_TEST_MAP,
            reservedTurnStoreOptions: { maxGeneralTurns: 12, maxNationTurns: 12 },
        });

        for (let turn = 0; turn < 8; turn += 1) {
            await runOneTick();
        }

        expect(
            world
                .peekDirtyState()
                .messages.filter(
                    (message) => message.msgType === 'diplomacy' && message.option?.action === 'noAggression'
                )
        ).toHaveLength(0);
    });

    it('does not propose again after the accepted pact accounts for all received aid', async () => {
        const fixture = createFixture({
            npcState: 2,
            nationMeta: {
                recv_assist: { n2: [2, 1_000_000] },
                resp_assist: { n2: [2, 1_000_000] },
                npc_nation_policy: { priority: ['불가침제의'] },
            },
        });
        const { world, runOneTick } = await createTurnTestHarness({
            ...fixture,
            schedule,
            map: LARGE_TEST_MAP,
            reservedTurnStoreOptions: { maxGeneralTurns: 12, maxNationTurns: 12 },
        });

        for (let turn = 0; turn < 8; turn += 1) {
            await runOneTick();
        }

        expect(
            world
                .peekDirtyState()
                .messages.filter(
                    (message) => message.msgType === 'diplomacy' && message.option?.action === 'noAggression'
                )
        ).toHaveLength(0);
    });
});

describe('불가침 만료와 선전포고 lifecycle', () => {
    it('blocks declaration during the pact, decrements monthly, then allows declaration after trade resumes', async () => {
        const fixture = createFixture({ npcState: 0, term: 2 });
        const resolved: Array<{ requestedAction: string; actionKey: string; blockedReason?: string }> = [];
        const { world, reservedTurnStore, runOneTick } = await createTurnTestHarness({
            ...fixture,
            schedule,
            map: LARGE_TEST_MAP,
            reservedTurnStoreOptions: { maxGeneralTurns: 12, maxNationTurns: 12 },
            onActionResolved: (event) => {
                if (event.kind === 'nation') resolved.push(event);
            },
        });
        const setDeclaration = () => {
            reservedTurnStore.getNationTurns(1, 12)[0] = {
                action: 'che_선전포고',
                args: { destNationId: 2 },
            };
        };
        const getForward = () =>
            world.listDiplomacy().find((entry) => entry.fromNationId === 1 && entry.toNationId === 2)!;

        setDeclaration();
        await runOneTick();
        expect(resolved.at(-1)).toMatchObject({
            requestedAction: 'che_선전포고',
            blockedReason: '불가침국입니다.',
        });
        expect(getForward()).toMatchObject({ state: DIPLOMACY_STATE.NON_AGGRESSION, term: 1 });

        const monthlyDiplomacy = createMonthlyDiplomacyHandler({ getWorld: () => world });
        await monthlyDiplomacy.onMonthChanged?.({} as never);
        expect(getForward()).toMatchObject({ state: DIPLOMACY_STATE.TRADE, term: 0 });

        setDeclaration();
        await runOneTick();
        expect(resolved.at(-1)).toMatchObject({
            requestedAction: 'che_선전포고',
            actionKey: 'che_선전포고',
        });
        expect(resolved.at(-1)?.blockedReason).toBeUndefined();
        // runOneTick은 명령 실행 뒤 같은 월의 외교 월말 처리까지 완료한다.
        expect(getForward()).toMatchObject({ state: DIPLOMACY_STATE.DECLARATION, term: 23 });
    });
});
