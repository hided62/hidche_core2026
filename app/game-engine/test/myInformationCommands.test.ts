import { describe, expect, it, vi } from 'vitest';

import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import {
    LogCategory,
    LogFormat,
    LogScope,
    type MapDefinition,
    type ScenarioEffectKey,
    type TurnSchedule,
} from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { createImmediateGeneralActionExecutor } from '../src/turn/reservedTurnHandler.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';

const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };

const buildMapCity = (id: number, connections: number[]): MapDefinition['cities'][number] => ({
    id,
    name: `도시${id}`,
    level: 1,
    region: 1,
    position: { x: id, y: id },
    connections,
    max: {
        population: 100_000,
        agriculture: 1_000,
        commerce: 1_000,
        security: 1_000,
        defence: 1_000,
        wall: 1_000,
    },
    initial: {
        population: 10_000,
        agriculture: 100,
        commerce: 100,
        security: 100,
        defence: 100,
        wall: 100,
    },
});

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
        items: { horse: 'che_명마_02_조랑', weapon: null, book: null, item: null },
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
        nations: [
            {
                id: 1,
                name: '테스트국',
                color: '#111111',
                typeCode: 'che_중립',
                level: 1,
                capitalCityId: null,
                chiefGeneralId: 7,
                gold: 0,
                rice: 0,
                power: 0,
                meta: {},
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

const buildImmediateActionWorld = (options: {
    general: TurnGeneral;
    additionalGenerals?: TurnGeneral[];
    cities: TurnWorldSnapshot['cities'];
    nations: TurnWorldSnapshot['nations'];
    map: MapDefinition;
    availableInstantRetreat?: boolean;
    lastTurnTime?: Date;
    scenarioConst?: Record<string, unknown>;
}) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 180,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: options.lastTurnTime ?? new Date('0180-01-01T00:00:00Z'),
        meta: {
            hiddenSeed: 'immediate-action-test',
            killturn: 24,
            opentime: '0180-02-01T00:00:00.000Z',
            scenarioId: 1000,
        },
    };
    const scenarioMeta = {
        title: '즉시 행동 테스트',
        startYear: 180,
        life: null,
        fiction: null,
        history: [],
        ignoreDefaultEvents: false,
    };
    const snapshot: TurnWorldSnapshot = {
        generals: [options.general, ...(options.additionalGenerals ?? [])],
        cities: options.cities,
        nations: options.nations,
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 65 },
            iconPath: '',
            map: {},
            const: {
                openingPartYear: 3,
                baseRice: 2_000,
                availableInstantAction: {
                    instantRetreat: options.availableInstantRetreat ?? false,
                },
                ...(options.scenarioConst ?? {}),
            },
            environment: {
                mapName: 'test',
                unitSet: 'test',
            },
        },
        scenarioMeta,
        map: options.map,
    };
    const world = new InMemoryTurnWorld(state, snapshot, { schedule });
    const ensureNationTurns = vi.fn();
    const reservedTurns = { ensureNationTurns } as unknown as InMemoryReservedTurnStore;
    const handler = createTurnDaemonCommandHandler({
        world,
        reservedTurns,
        scenarioMeta,
        map: options.map,
    });
    return { world, handler, ensureNationTurns, reservedTurns, scenarioMeta };
};

describe('my information world commands', () => {
    it('normalizes legacy settings and charges myset only when defence mode changes', async () => {
        const fixture = buildWorld();

        await expect(
            fixture.handler.handle({
                type: 'setMySetting',
                userId: 'user-7',
                generalId: 7,
                settings: {
                    tnmt: 9,
                    defence_train: 94,
                    use_treatment: 200,
                    use_auto_nation_turn: 0,
                    use_auto_nation_diplomacy: 1,
                    use_auto_nation_war: 1,
                    use_auto_nation_promotion: 1,
                    use_auto_nation_finance: 1,
                    use_auto_nation_capital: 1,
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
                use_auto_nation_diplomacy: 1,
                use_auto_nation_war: 1,
                use_auto_nation_promotion: 1,
                use_auto_nation_finance: 1,
                use_auto_nation_capital: 1,
                myset: 2,
            },
        });

        await fixture.handler.handle({
            type: 'setMySetting',
            userId: 'user-7',
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
                userId: 'user-7',
                generalId: 7,
                settings: { defence_train: 999 },
            });
            expect(fixture.world.getGeneralById(7)).toMatchObject({ train: 90, atmos: 90 });
        }
    );

    it('applies vacation killturn and rejects it in automatic-turn mode', async () => {
        const allowed = buildWorld();
        await expect(
            allowed.handler.handle({ type: 'vacation', userId: 'user-7', generalId: 7 })
        ).resolves.toMatchObject({ ok: true });
        expect(allowed.world.getGeneralById(7)?.meta.killturn).toBe(72);

        const blocked = buildWorld(buildGeneral(), { autorunLimit: true });
        await expect(
            blocked.handler.handle({ type: 'vacation', userId: 'user-7', generalId: 7 })
        ).resolves.toMatchObject({
            ok: false,
            reason: '자동 턴인 경우에는 휴가 명령이 불가능합니다.',
        });
        expect(blocked.world.getGeneralById(7)?.meta.killturn).toBe(12);
    });

    it('drops a buyable item with only the Ref personal action log', async () => {
        const fixture = buildWorld();
        await expect(
            fixture.handler.handle({ type: 'dropItem', userId: 'user-7', generalId: 7, itemType: 'weapon' })
        ).resolves.toMatchObject({ ok: false });
        await expect(
            fixture.handler.handle({ type: 'dropItem', userId: 'user-7', generalId: 7, itemType: 'horse' })
        ).resolves.toMatchObject({ ok: true });
        expect(fixture.world.getGeneralById(7)?.role.items.horse).toBeNull();
        expect(fixture.world.peekDirtyState().logs).toEqual([
            {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
                text: '<C>조랑(+2)</>을 버렸습니다.',
                generalId: 7,
                meta: {},
            },
        ]);
    });

    it('adds Ref global loss logs when dropping a non-buyable item', async () => {
        const fixture = buildWorld(
            buildGeneral({
                role: {
                    items: { horse: null, weapon: null, book: 'che_서적_14_한비자', item: null },
                    personality: null,
                    specialDomestic: null,
                    specialWar: null,
                },
            })
        );

        await expect(
            fixture.handler.handle({ type: 'dropItem', userId: 'user-7', generalId: 7, itemType: 'book' })
        ).resolves.toMatchObject({ ok: true });
        expect(fixture.world.getGeneralById(7)?.role.items.book).toBeNull();
        expect(fixture.world.peekDirtyState().logs).toEqual([
            {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
                text: '<C>한비자(+14)</>를 버렸습니다.',
                generalId: 7,
                meta: {},
            },
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.SUMMARY,
                format: LogFormat.MONTH,
                text: '<Y>테스트장수</>가 <C>한비자(+14)</>를 잃었습니다!',
                meta: {},
            },
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
                text: '<R><b>【망실】</b></><D><b>테스트국</b></>의 <Y>테스트장수</>가 <C>한비자(+14)</>를 잃었습니다!',
                meta: {},
            },
        ]);
    });

    it('drops and logs an item stored under a mismatched equipment slot like Ref', async () => {
        const fixture = buildWorld(
            buildGeneral({
                role: {
                    items: { horse: null, weapon: 'che_명마_02_조랑', book: null, item: null },
                    personality: null,
                    specialDomestic: null,
                    specialWar: null,
                },
            })
        );

        await expect(
            fixture.handler.handle({ type: 'dropItem', userId: 'user-7', generalId: 7, itemType: 'weapon' })
        ).resolves.toMatchObject({ type: 'dropItem', ok: true, generalId: 7 });
        expect(fixture.world.getGeneralById(7)?.role.items.weapon).toBeNull();
        expect(fixture.world.peekDirtyState().logs).toEqual([
            {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
                text: '<C>조랑(+2)</>을 버렸습니다.',
                generalId: 7,
                meta: {},
            },
        ]);
    });

    it('executes pre-open uprising through the action stack without advancing the turn clock', async () => {
        const general = buildGeneral({
            nationId: 0,
            cityId: 1,
            turnTime: new Date('0180-01-01T00:10:00Z'),
            experience: 0,
            dedication: 0,
            meta: {
                killturn: 3,
                inherit_active_action: 2,
                leadership_exp: 0,
                strength_exp: 0,
                intel_exp: 0,
            },
        });
        const fixture = buildImmediateActionWorld({
            general,
            cities: [
                {
                    id: 1,
                    name: '낙양',
                    nationId: 0,
                    supplyState: 1,
                    meta: {},
                } as TurnWorldSnapshot['cities'][number],
            ],
            nations: [
                {
                    id: 1,
                    name: general.name,
                    color: '#111111',
                    typeCode: 'che_중립',
                    level: 1,
                    capitalCityId: 0,
                    chiefGeneralId: 0,
                    gold: 0,
                    rice: 0,
                    power: 0,
                    meta: {},
                },
            ],
            map: {
                id: 'test',
                name: 'test',
                cities: [buildMapCity(1, [])],
            },
        });

        await expect(
            fixture.handler.handle({
                type: 'buildNationCandidate',
                userId: general.userId!,
                generalId: general.id,
            })
        ).resolves.toMatchObject({ ok: true });

        const createdNation = fixture.world.listNations().find((nation) => nation.id === 2);
        expect(createdNation).toMatchObject({
            name: `㉥${general.name}`,
            color: '#330000',
            typeCode: 'che_중립',
            level: 0,
            capitalCityId: 0,
            chiefGeneralId: general.id,
            gold: 0,
            rice: 2_000,
            meta: {
                rate: 20,
                bill: 100,
                strategic_cmd_limit: 12,
                surlimit: 72,
                secretlimit: 1,
                gennum: 1,
            },
        });
        expect(fixture.world.getGeneralById(general.id)).toMatchObject({
            nationId: 2,
            officerLevel: 12,
            experience: 100,
            dedication: 100,
            turnTime: general.turnTime,
            lastTurn: { command: '거병', arg: {} },
            meta: {
                belong: 1,
                officer_city: 0,
                inherit_active_action: 3,
                killturn: 24,
            },
        });
        expect(fixture.ensureNationTurns.mock.calls).toEqual([
            [2, 12],
            [2, 11],
        ]);
        expect(fixture.world.getDiplomacyEntry(1, 2)).toMatchObject({ state: 2, term: 0 });
        expect(fixture.world.getDiplomacyEntry(2, 1)).toMatchObject({ state: 2, term: 0 });
        const { logs } = fixture.world.consumeDirtyState();
        expect(logs.map((entry) => entry.text)).toEqual(
            expect.arrayContaining([
                '거병에 성공하였습니다. <1>00:10</>',
                expect.stringContaining('낙양'),
                expect.stringContaining('세력을 결성하였습니다.'),
            ])
        );
    });

    it('rejects a penalized uprising before allocating a nation or writing a log', async () => {
        const general = buildGeneral({
            nationId: 0,
            cityId: 1,
            penalty: { noFoundNation: true },
        });
        const fixture = buildImmediateActionWorld({
            general,
            cities: [{ id: 1, name: '낙양', nationId: 0, supplyState: 1, meta: {} }] as TurnWorldSnapshot['cities'],
            nations: [],
            map: {
                id: 'test',
                name: 'test',
                cities: [buildMapCity(1, [])],
            },
        });

        await expect(
            fixture.handler.handle({
                type: 'buildNationCandidate',
                userId: general.userId!,
                generalId: general.id,
            })
        ).resolves.toMatchObject({ ok: false });
        expect(fixture.world.listNations()).toEqual([]);
        expect(fixture.world.getGeneralById(general.id)).toMatchObject({
            nationId: 0,
            experience: general.experience,
            dedication: general.dedication,
        });
        expect(fixture.ensureNationTurns).not.toHaveBeenCalled();
        expect(fixture.world.consumeDirtyState().logs).toEqual([]);
    });

    it('uses the Ref generic unique seed independently from the immediate-action RNG', async () => {
        const general = buildGeneral({
            nationId: 0,
            cityId: 1,
            meta: {
                killturn: 3,
                inheritRandomUnique: true,
                leadership_exp: 0,
                strength_exp: 0,
                intel_exp: 0,
            },
        });
        const map = {
            id: 'test',
            name: 'test',
            cities: [buildMapCity(1, [])],
        };
        const fixture = buildImmediateActionWorld({
            general,
            cities: [{ id: 1, name: '낙양', nationId: 0, supplyState: 1, meta: {} }] as TurnWorldSnapshot['cities'],
            nations: [],
            map,
            scenarioConst: {
                allItems: {
                    weapon: {
                        che_무기_12_칠성검: 1,
                    },
                },
                maxUniqueItemLimit: [[-1, 1]],
                minMonthToAllowInheritItem: 0,
            },
        });
        const actionRng = new RandUtil(new LiteHashDRBG('immediate-action-main-rng'));
        const nextFloat = vi.spyOn(actionRng, 'nextFloat1');
        const nextInt = vi.spyOn(actionRng, 'nextInt');
        const nextIntInclusive = vi.spyOn(actionRng, 'nextIntInclusive');
        const executor = await createImmediateGeneralActionExecutor({
            world: fixture.world,
            reservedTurns: fixture.reservedTurns,
            scenarioMeta: fixture.scenarioMeta,
            map,
        });

        await expect(
            executor.execute({
                actionKey: 'che_거병',
                generalId: general.id,
                rng: actionRng,
                refreshKillturn: true,
            })
        ).resolves.toEqual({ ok: true });
        expect(fixture.world.getGeneralById(general.id)?.role.items.weapon).toBe('che_무기_12_칠성검');
        expect(fixture.world.consumeDirtyState().logs.some((entry) => entry.text.includes('【아이템】'))).toBe(true);
        expect(nextFloat).not.toHaveBeenCalled();
        expect(nextInt).not.toHaveBeenCalled();
        expect(nextIntInclusive).not.toHaveBeenCalled();
    });

    it('loads the internal recruitment acceptance action outside the selectable command profile', async () => {
        const originalLastTurn = { command: '전투태세', arg: { term: 3 } };
        const recipient = buildGeneral({
            id: 8,
            userId: 'user-8',
            name: '재야장수',
            nationId: 0,
            cityId: 1,
            officerLevel: 0,
            lastTurn: originalLastTurn,
        });
        const recruiter = buildGeneral({
            id: 9,
            userId: 'user-9',
            name: '등용장수',
            nationId: 2,
            cityId: 2,
        });
        const map = {
            id: 'test',
            name: 'test',
            cities: [buildMapCity(1, [2]), buildMapCity(2, [1])],
        };
        const fixture = buildImmediateActionWorld({
            general: recipient,
            additionalGenerals: [recruiter],
            cities: [
                { id: 1, name: '낙양', nationId: 0, supplyState: 1, meta: {} },
                { id: 2, name: '장안', nationId: 2, supplyState: 1, meta: {} },
            ] as TurnWorldSnapshot['cities'],
            nations: [
                {
                    id: 2,
                    name: '등용국',
                    color: '#222222',
                    typeCode: 'che_중립',
                    level: 1,
                    capitalCityId: 2,
                    chiefGeneralId: recruiter.id,
                    gold: 0,
                    rice: 0,
                    power: 0,
                    meta: { gennum: 1 },
                },
            ] as TurnWorldSnapshot['nations'],
            map,
        });
        const executor = await createImmediateGeneralActionExecutor({
            world: fixture.world,
            reservedTurns: fixture.reservedTurns,
            scenarioMeta: fixture.scenarioMeta,
            map,
            commandProfile: {
                general: ['che_등용'],
                nation: [],
            },
        });

        await expect(
            executor.execute({
                actionKey: 'che_등용수락',
                generalId: recipient.id,
                rng: new RandUtil(new LiteHashDRBG('accept-recruitment-letter')),
                args: { destNationId: 2, destGeneralId: recruiter.id },
            })
        ).resolves.toEqual({ ok: true });
        expect(fixture.world.getGeneralById(recipient.id)).toMatchObject({
            nationId: 2,
            cityId: 2,
            officerLevel: 1,
            lastTurn: originalLastTurn,
        });
        expect(fixture.world.getGeneralById(recruiter.id)).toMatchObject({
            experience: recruiter.experience + 100,
            dedication: recruiter.dedication + 100,
        });
        const actionLogs = fixture.world
            .consumeDirtyState()
            .logs.filter((log) => log.scope === LogScope.GENERAL && log.category === LogCategory.ACTION);
        expect(actionLogs.map((log) => log.text)).toEqual([
            expect.stringContaining('레벨업'),
            expect.stringContaining('승급'),
            expect.stringContaining('망명하여 수도로'),
            expect.stringContaining('레벨업'),
            expect.stringContaining('승급'),
            expect.stringContaining('등용에 성공했습니다.'),
        ]);
        expect(actionLogs.map((log) => log.format)).toEqual([
            LogFormat.PLAIN,
            LogFormat.PLAIN,
            LogFormat.MONTH,
            LogFormat.PLAIN,
            LogFormat.PLAIN,
            LogFormat.MONTH,
        ]);
    });

    it('accepts a recruitment letter after the recruiter was deleted and preserves the reserved command', async () => {
        const deletedRecruiterId = 99;
        const originalLastTurn = { command: '내정 특기 초기화', arg: { phase: 2 } };
        const recipient = buildGeneral({
            id: 8,
            userId: 'user-8',
            name: '재야장수',
            nationId: 0,
            cityId: 1,
            officerLevel: 0,
            lastTurn: originalLastTurn,
        });
        const map = {
            id: 'test',
            name: 'test',
            cities: [buildMapCity(1, [2]), buildMapCity(2, [1])],
        };
        const fixture = buildImmediateActionWorld({
            general: recipient,
            cities: [
                { id: 1, name: '낙양', nationId: 0, supplyState: 1, meta: {} },
                { id: 2, name: '장안', nationId: 2, supplyState: 1, meta: {} },
            ] as TurnWorldSnapshot['cities'],
            nations: [
                {
                    id: 2,
                    name: '등용국',
                    color: '#222222',
                    typeCode: 'che_중립',
                    level: 1,
                    capitalCityId: 2,
                    chiefGeneralId: deletedRecruiterId,
                    gold: 0,
                    rice: 0,
                    power: 0,
                    meta: { gennum: 1 },
                },
            ] as TurnWorldSnapshot['nations'],
            map,
        });
        const executor = await createImmediateGeneralActionExecutor({
            world: fixture.world,
            reservedTurns: fixture.reservedTurns,
            scenarioMeta: fixture.scenarioMeta,
            map,
            commandProfile: { general: ['che_등용'], nation: [] },
        });

        await expect(
            executor.execute({
                actionKey: 'che_등용수락',
                generalId: recipient.id,
                rng: new RandUtil(new LiteHashDRBG('accept-deleted-recruiter-letter')),
                args: { destNationId: 2, destGeneralId: deletedRecruiterId },
            })
        ).resolves.toEqual({ ok: true });

        expect(fixture.world.getGeneralById(recipient.id)).toMatchObject({
            nationId: 2,
            cityId: 2,
            officerLevel: 1,
            lastTurn: originalLastTurn,
        });
        expect(fixture.world.getNationById(2)?.meta.gennum).toBe(2);
        expect(fixture.world.peekDirtyState().logs).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ generalId: deletedRecruiterId })])
        );
    });

    it('preserves the Ref uprising precheck order and messages after the game starts', async () => {
        const general = buildGeneral({ nationId: 1, cityId: 1 });
        const fixture = buildImmediateActionWorld({
            general,
            cities: [{ id: 1, name: '낙양', nationId: 1, supplyState: 1, meta: {} }] as TurnWorldSnapshot['cities'],
            nations: [],
            map: {
                id: 'test',
                name: 'test',
                cities: [buildMapCity(1, [])],
            },
            lastTurnTime: new Date('0180-03-01T00:00:00.000Z'),
        });

        await expect(
            fixture.handler.handle({
                type: 'buildNationCandidate',
                userId: general.userId!,
                generalId: general.id,
            })
        ).resolves.toMatchObject({
            ok: false,
            reason: '게임이 시작되었습니다.',
        });
    });

    it('executes instant retreat with the legacy seed and leaves the reserved turn untouched', async () => {
        const originalLastTurn = { command: '훈련', arg: { marker: 1 } };
        const general = buildGeneral({
            nationId: 1,
            cityId: 2,
            turnTime: new Date('0180-01-01T00:10:00Z'),
            lastTurn: originalLastTurn,
        });
        const map = {
            id: 'test',
            name: 'test',
            cities: [buildMapCity(1, [2]), buildMapCity(2, [1])],
        };
        const cities = [
            { id: 1, name: '낙양', nationId: 1, supplyState: 1, meta: {} },
            { id: 2, name: '장안', nationId: 2, supplyState: 1, meta: {} },
        ] as TurnWorldSnapshot['cities'];
        const nations = [
            {
                id: 1,
                name: '아국',
                color: '#111111',
                typeCode: 'che_중립',
                level: 1,
                capitalCityId: 1,
                chiefGeneralId: general.id,
                gold: 0,
                rice: 0,
                power: 0,
                meta: {},
            },
            {
                id: 2,
                name: '타국',
                color: '#222222',
                typeCode: 'che_중립',
                level: 1,
                capitalCityId: 2,
                chiefGeneralId: 0,
                gold: 0,
                rice: 0,
                power: 0,
                meta: {},
            },
        ] as TurnWorldSnapshot['nations'];
        const fixture = buildImmediateActionWorld({
            general,
            cities,
            nations,
            map,
            availableInstantRetreat: true,
        });

        await expect(
            fixture.handler.handle({
                type: 'instantRetreat',
                userId: general.userId!,
                generalId: general.id,
            })
        ).resolves.toMatchObject({
            ok: true,
        });
        expect(fixture.world.getGeneralById(general.id)).toMatchObject({
            cityId: 1,
            turnTime: general.turnTime,
            lastTurn: originalLastTurn,
        });
        expect(fixture.world.consumeDirtyState().logs.map((entry) => entry.text)).toContain(
            '<G><b>낙양</b></>으로 접경귀환했습니다.'
        );
    });

    it('chooses equal-distance retreat cities in the Ref map BFS connection order', async () => {
        const general = buildGeneral({ nationId: 1, cityId: 2 });
        const map = {
            id: 'test',
            name: 'test',
            cities: [buildMapCity(1, [2]), buildMapCity(2, [3, 1]), buildMapCity(3, [2])],
        };
        const fixture = buildImmediateActionWorld({
            general,
            cities: [
                { id: 1, name: '첫째', nationId: 1, supplyState: 1, meta: {} },
                { id: 3, name: '셋째', nationId: 1, supplyState: 1, meta: {} },
                { id: 2, name: '출발', nationId: 2, supplyState: 1, meta: {} },
            ] as TurnWorldSnapshot['cities'],
            nations: [
                {
                    id: 1,
                    name: '아국',
                    color: '#111111',
                    typeCode: 'che_중립',
                    level: 1,
                    capitalCityId: 1,
                    chiefGeneralId: general.id,
                    gold: 0,
                    rice: 0,
                    power: 0,
                    meta: {},
                },
            ],
            map,
            availableInstantRetreat: true,
        });
        const expectedIndex = new RandUtil(
            new LiteHashDRBG(
                simpleSerialize('immediate-action-test', 'InstantRetreat', general.id, 180, 1, general.cityId)
            )
        ).nextIntInclusive(1);

        await expect(
            fixture.handler.handle({
                type: 'instantRetreat',
                userId: general.userId!,
                generalId: general.id,
            })
        ).resolves.toMatchObject({ ok: true });
        expect(fixture.world.getGeneralById(general.id)?.cityId).toBe([3, 1][expectedIndex]);
    });

    it('rejects an immediate action when the command user does not own the runtime general', async () => {
        const general = buildGeneral({ nationId: 0, cityId: 1 });
        const fixture = buildImmediateActionWorld({
            general,
            cities: [{ id: 1, name: '낙양', nationId: 0, supplyState: 1, meta: {} }] as TurnWorldSnapshot['cities'],
            nations: [],
            map: {
                id: 'test',
                name: 'test',
                cities: [buildMapCity(1, [])],
            },
        });

        await expect(
            fixture.handler.handle({
                type: 'buildNationCandidate',
                userId: 'different-user',
                generalId: general.id,
            })
        ).rejects.toThrow('general owner does not match command user');
        expect(fixture.world.listNations()).toEqual([]);
    });

    it('attributes an instant-retreat constraint failure to the session general log', async () => {
        const general = buildGeneral({ nationId: 0, cityId: 1 });
        const fixture = buildImmediateActionWorld({
            general,
            cities: [{ id: 1, name: '낙양', nationId: 0, supplyState: 1, meta: {} }] as TurnWorldSnapshot['cities'],
            nations: [],
            map: {
                id: 'test',
                name: 'test',
                cities: [buildMapCity(1, [])],
            },
            availableInstantRetreat: true,
        });

        await expect(
            fixture.handler.handle({
                type: 'instantRetreat',
                userId: general.userId!,
                generalId: general.id,
            })
        ).resolves.toMatchObject({ ok: false });
        expect(fixture.world.consumeDirtyState().logs).toEqual([
            expect.objectContaining({
                scope: 'GENERAL',
                category: 'ACTION',
                generalId: general.id,
            }),
        ]);
    });

    it('persists the ref failure log when instant retreat has no reachable supplied city', async () => {
        const general = buildGeneral({ nationId: 1, cityId: 2 });
        const fixture = buildImmediateActionWorld({
            general,
            cities: [
                { id: 1, name: '낙양', nationId: 1, supplyState: 0, meta: {} },
                { id: 2, name: '장안', nationId: 2, supplyState: 1, meta: {} },
            ] as TurnWorldSnapshot['cities'],
            nations: [
                {
                    id: 1,
                    name: '아국',
                    color: '#111111',
                    typeCode: 'che_중립',
                    level: 1,
                    capitalCityId: 1,
                    chiefGeneralId: general.id,
                    gold: 0,
                    rice: 0,
                    power: 0,
                    meta: {},
                },
            ],
            map: {
                id: 'test',
                name: 'test',
                cities: [buildMapCity(1, [2]), buildMapCity(2, [1])],
            },
            availableInstantRetreat: true,
        });

        await expect(
            fixture.handler.handle({
                type: 'instantRetreat',
                userId: general.userId!,
                generalId: general.id,
            })
        ).resolves.toMatchObject({
            ok: false,
            reason: '가까운 아국 도시가 없습니다.',
        });
        expect(fixture.world.getGeneralById(general.id)?.cityId).toBe(2);
        expect(fixture.world.consumeDirtyState().logs.map((entry) => entry.text)).toContain(
            '3칸 이내에 아국 도시가 없습니다.'
        );
    });

    it('checks the Ref instant-retreat scenario gate before looking up the general', async () => {
        const general = buildGeneral({ nationId: 1, cityId: 1 });
        const fixture = buildImmediateActionWorld({
            general,
            cities: [{ id: 1, name: '낙양', nationId: 1, supplyState: 1, meta: {} }] as TurnWorldSnapshot['cities'],
            nations: [],
            map: {
                id: 'test',
                name: 'test',
                cities: [buildMapCity(1, [])],
            },
            availableInstantRetreat: false,
        });
        fixture.world.removeGeneral(general.id);

        await expect(
            fixture.handler.handle({
                type: 'instantRetreat',
                userId: general.userId!,
                generalId: general.id,
            })
        ).resolves.toMatchObject({
            ok: false,
            reason: '접경귀환을 사용할 수 없는 시나리오입니다.',
        });
    });
});
