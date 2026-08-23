import { describe, expect, it } from 'vitest';
import type { City, General, Nation } from '../../../src/domain/entities.js';
import type { WorldSnapshot } from '../../../src/world/types.js';
import { InMemoryWorld, TestGameRunner } from '../../testEnv.js';
import { MINIMAL_MAP } from '../../fixtures/minimalMap.js';
import type { TurnCommandEnv, TurnCommandItemCatalogEntry } from '../../../src/actions/turn/commandEnv.js';
import { commandSpec as rebellionSpec } from '../../../src/actions/turn/general/che_모반시도.js';
import { commandSpec as abdicationSpec } from '../../../src/actions/turn/general/che_선양.js';
import { commandSpec as uprisingSpec } from '../../../src/actions/turn/general/che_거병.js';
import { commandSpec as giftSpec } from '../../../src/actions/turn/general/che_증여.js';
import { commandSpec as disbandSpec } from '../../../src/actions/turn/general/che_해산.js';
import { commandSpec as foundNationSpec } from '../../../src/actions/turn/general/cr_건국.js';
import { commandSpec as tradeItemSpec } from '../../../src/actions/turn/general/che_장비매매.js';
import type { ConstraintContext, RequirementKey, StateView } from '../../../src/constraints/types.js';
import { evaluateActionConstraints } from '../../../src/constraints/evaluate.js';
import { resolveGeneralAction } from '../../../src/actions/engine.js';
import { orderLegacyActionLoggerFlush } from '../../../src/logging/actionLogger.js';
import { LogCategory, LogFormat, LogScope } from '../../../src/logging/types.js';

const SYSTEM_ENV: TurnCommandEnv = {
    develCost: 100,
    trainDelta: 35,
    atmosDelta: 35,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    sabotageDefaultProb: 0.5,
    sabotageProbCoefByStat: 0.1,
    sabotageDefenceCoefByGeneralCount: 0.1,
    sabotageDamageMin: 10,
    sabotageDamageMax: 30,
    openingPartYear: 200,
    maxGeneral: 10,
    defaultNpcGold: 1000,
    defaultNpcRice: 1000,
    defaultCrewTypeId: 1,
    defaultSpecialDomestic: null,
    defaultSpecialWar: null,
    initialNationGenLimit: 10,
    maxTechLevel: 10,
    baseGold: 1000,
    baseRice: 1000,
    maxResourceActionAmount: 10000,
};

const makeGeneral = (params: {
    id: number;
    nationId: number;
    cityId: number;
    name?: string;
    officerLevel?: number;
    experience?: number;
    dedication?: number;
    gold?: number;
    rice?: number;
    crew?: number;
    meta?: Record<string, unknown>;
    items?: Partial<General['role']['items']>;
}): General => ({
    id: params.id,
    name: params.name ?? `장수${params.id}`,
    nationId: params.nationId,
    cityId: params.cityId,
    troopId: 0,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    experience: params.experience ?? 0,
    dedication: params.dedication ?? 0,
    officerLevel: params.officerLevel ?? 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: {
            horse: params.items?.horse ?? null,
            weapon: params.items?.weapon ?? null,
            book: params.items?.book ?? null,
            item: params.items?.item ?? null,
        },
    },
    injury: 0,
    gold: params.gold ?? 1000,
    rice: params.rice ?? 1000,
    crew: params.crew ?? 500,
    crewTypeId: 1,
    train: 20,
    atmos: 20,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: {
        killturn: 24,
        ...(params.meta ?? {}),
    },
});

const makeNation = (params: {
    id: number;
    name?: string;
    level?: number;
    typeCode?: string;
    capitalCityId?: number | null;
    chiefGeneralId?: number | null;
    gold?: number;
    rice?: number;
    meta?: Record<string, unknown>;
}): Nation => ({
    id: params.id,
    name: params.name ?? `국가${params.id}`,
    color: '#ff0000',
    capitalCityId: params.capitalCityId ?? 1,
    chiefGeneralId: params.chiefGeneralId ?? 1,
    gold: params.gold ?? 10000,
    rice: params.rice ?? 10000,
    power: 0,
    level: params.level ?? 1,
    typeCode: params.typeCode ?? 'che_def',
    meta: {
        killturn: 24,
        ...(params.meta ?? {}),
    },
});

const makeCity = (params: { id: number; nationId: number; level?: number; supplyState?: number }): City => ({
    id: params.id,
    name: `도시${params.id}`,
    nationId: params.nationId,
    level: params.level ?? 1,
    state: 0,
    population: 20000,
    populationMax: 50000,
    agriculture: 500,
    agricultureMax: 1000,
    commerce: 500,
    commerceMax: 1000,
    security: 500,
    securityMax: 1000,
    defence: 300,
    defenceMax: 1000,
    wall: 300,
    wallMax: 1000,
    supplyState: params.supplyState ?? 1,
    frontState: 0,
    meta: { trust: 50, trade: 100 },
});

const makeSnapshot = (params: {
    generals: General[];
    nations: Nation[];
    cities: City[];
    startYear?: number;
}): WorldSnapshot => ({
    scenarioConfig: {
        environment: { mapName: 'minimal_map', unitSet: 'default' },
        options: {},
        const: {},
    } as any,
    scenarioMeta: {
        title: '테스트',
        startYear: params.startYear ?? 200,
        life: 0,
        fiction: 0,
        history: [],
        ignoreDefaultEvents: false,
    },
    map: MINIMAL_MAP,
    unitSet: { id: 'default', name: 'default', crewTypes: [] } as any,
    nations: params.nations,
    cities: params.cities,
    generals: params.generals,
    troops: [],
    diplomacy: [],
    events: [],
    initialEvents: [],
});

const resolveForLogOrdering = (
    resolver: any,
    general: General,
    city: City,
    nation: Nation | null,
    args: unknown,
    context: Record<string, unknown>
) =>
    resolveGeneralAction(
        resolver,
        {
            general,
            city,
            nation,
            rng: {} as any,
            addLog: () => {},
            ...context,
        } as any,
        {
            now: new Date('2026-08-23T00:00:00.000Z'),
            schedule: { entries: [{ startMinute: 0, tickMinutes: 60 }] },
        },
        args
    );

describe('migrated general commands', () => {
    it('che_모반시도: 군주를 찬탈한다', async () => {
        const lord = makeGeneral({ id: 1, nationId: 1, cityId: 1, name: '군주', officerLevel: 12, experience: 1000 });
        const chief = makeGeneral({ id: 2, nationId: 1, cityId: 1, name: '중신', officerLevel: 2, experience: 300 });
        const nation = makeNation({ id: 1, name: '위', chiefGeneralId: 1, capitalCityId: 1, level: 1 });
        const city = makeCity({ id: 1, nationId: 1 });

        const world = new InMemoryWorld(makeSnapshot({ generals: [lord, chief], nations: [nation], cities: [city] }));
        const runner = new TestGameRunner(world, 201, 1);

        await runner.runTurn([
            {
                generalId: chief.id,
                commandKey: 'che_모반시도',
                resolver: rebellionSpec.createDefinition(SYSTEM_ENV),
                args: {},
                context: {
                    nationGenerals: [lord, chief],
                },
            },
        ]);

        const updatedChief = world.getGeneral(chief.id)!;
        const updatedLord = world.getGeneral(lord.id)!;
        expect(updatedChief.officerLevel).toBe(12);
        expect(updatedLord.officerLevel).toBe(1);
        expect(updatedLord.experience).toBe(700);
        expect(world.getNation(nation.id)?.chiefGeneralId).toBe(chief.id);
    });

    it('che_선양: 제약 없는 대상에게 선양한다', async () => {
        const lord = makeGeneral({ id: 1, nationId: 1, cityId: 1, name: '군주', officerLevel: 12, experience: 1000 });
        const heir = makeGeneral({ id: 2, nationId: 1, cityId: 1, name: '후계자', officerLevel: 1, experience: 200 });
        const nation = makeNation({ id: 1, name: '촉', chiefGeneralId: 1, capitalCityId: 1, level: 1 });
        const city = makeCity({ id: 1, nationId: 1 });

        const world = new InMemoryWorld(makeSnapshot({ generals: [lord, heir], nations: [nation], cities: [city] }));
        const runner = new TestGameRunner(world, 201, 1);

        await runner.runTurn([
            {
                generalId: lord.id,
                commandKey: 'che_선양',
                resolver: abdicationSpec.createDefinition(SYSTEM_ENV),
                args: { destGeneralID: heir.id },
                context: {
                    destGeneral: heir,
                },
            },
        ]);

        const updatedLord = world.getGeneral(lord.id)!;
        const updatedHeir = world.getGeneral(heir.id)!;
        expect(updatedHeir.officerLevel).toBe(12);
        expect(updatedLord.officerLevel).toBe(1);
        expect(updatedLord.experience).toBe(700);
        expect(world.getNation(1)!.chiefGeneralId).toBe(heir.id);
    });

    it('che_증여: 금은 레거시 최소 보유량 0을 적용해 요청한 금액을 이전한다', async () => {
        const actor = makeGeneral({ id: 1, nationId: 1, cityId: 1, name: '증여자', gold: 1300 });
        const dest = makeGeneral({ id: 2, nationId: 1, cityId: 1, name: '수령자', gold: 200 });
        const nation = makeNation({ id: 1, name: '오', chiefGeneralId: 1, capitalCityId: 1, level: 1 });
        const city = makeCity({ id: 1, nationId: 1 });

        const world = new InMemoryWorld(makeSnapshot({ generals: [actor, dest], nations: [nation], cities: [city] }));
        const runner = new TestGameRunner(world, 201, 1);

        await runner.runTurn([
            {
                generalId: actor.id,
                commandKey: 'che_증여',
                resolver: giftSpec.createDefinition(SYSTEM_ENV),
                args: { isGold: true, amount: 500, destGeneralID: dest.id },
                context: {
                    destGeneral: dest,
                },
            },
        ]);

        expect(world.getGeneral(actor.id)!.gold).toBe(800);
        expect(world.getGeneral(dest.id)!.gold).toBe(700);
    });

    it('che_해산: 방랑군 해산 시 세력과 소속을 정리한다', async () => {
        const lord = makeGeneral({
            id: 1,
            nationId: 1,
            cityId: 1,
            name: '군주',
            officerLevel: 12,
            gold: 1500,
            rice: 1800,
            meta: { belong: 5, max_belong: 2, permission: 'ambassador' },
        });
        const member = makeGeneral({
            id: 2,
            nationId: 1,
            cityId: 2,
            name: '부하',
            officerLevel: 1,
            gold: 2500,
            rice: 500,
            meta: { belong: 7, max_belong: 3, permission: 'auditor' },
        });
        const nation = makeNation({
            id: 1,
            name: '방랑군',
            chiefGeneralId: 1,
            capitalCityId: 1,
            level: 0,
            typeCode: 'None',
            meta: {},
        });
        const city1 = makeCity({ id: 1, nationId: 1, level: 5 });
        const city2 = makeCity({ id: 2, nationId: 1, level: 5 });

        const world = new InMemoryWorld(
            makeSnapshot({ generals: [lord, member], nations: [nation], cities: [city1, city2] })
        );
        const runner = new TestGameRunner(world, 201, 2);

        await runner.runTurn([
            {
                generalId: lord.id,
                commandKey: 'che_해산',
                resolver: disbandSpec.createDefinition(SYSTEM_ENV),
                args: {},
                context: {
                    nationGenerals: [lord, member],
                    nationCities: [city1, city2],
                    currentYearMonth: 201 * 12 + 2 - 1,
                    initYearMonth: 201 * 12 + 1 - 1,
                },
            },
        ]);

        const updatedLord = world.getGeneral(lord.id)!;
        const updatedMember = world.getGeneral(member.id)!;
        expect(updatedLord.nationId).toBe(0);
        expect(updatedMember.nationId).toBe(0);
        expect(updatedLord.meta.makelimit).toBe(12);
        expect(updatedLord.gold).toBe(1000);
        expect(updatedMember.gold).toBe(1000);
        expect(updatedLord.meta).toMatchObject({ belong: 0, max_belong: 5, permission: 'normal' });
        expect(updatedMember.meta).toMatchObject({ belong: 0, max_belong: 7, permission: 'normal' });
        expect(world.getCity(1)!.nationId).toBe(0);
        expect(world.getCity(2)!.nationId).toBe(0);
        expect(world.getNation(1)!.meta.collapsed).toBe(true);
    });

    it('별도 General logger를 actor applyDB 전후 순서로 flush한다', () => {
        const city = makeCity({ id: 1, nationId: 1 });
        const nation = makeNation({ id: 1, name: '위', chiefGeneralId: 1, capitalCityId: 1 });

        const rebel = makeGeneral({ id: 2, nationId: 1, cityId: 1, name: '중신', officerLevel: 2 });
        const displacedLord = makeGeneral({
            id: 1,
            nationId: 1,
            cityId: 1,
            name: '군주',
            officerLevel: 12,
            experience: 1000,
        });
        const rebellionLogs = orderLegacyActionLoggerFlush(
            resolveForLogOrdering(
                rebellionSpec.createDefinition(SYSTEM_ENV),
                rebel,
                city,
                nation,
                {},
                {
                    nationGenerals: [displacedLord, rebel],
                }
            ).logs
        );
        expect(
            rebellionLogs
                .filter((log) => log.generalId === displacedLord.id)
                .map((log) => [log.category, log.legacyFlushGroup])
        ).toEqual([
            [LogCategory.HISTORY, 1],
            [LogCategory.ACTION, 1],
        ]);

        const abdicator = makeGeneral({ id: 1, nationId: 1, cityId: 1, name: '군주', officerLevel: 12 });
        const recipient = makeGeneral({ id: 2, nationId: 1, cityId: 1, name: '후계자' });
        const abdicationLogs = orderLegacyActionLoggerFlush(
            resolveForLogOrdering(
                abdicationSpec.createDefinition(SYSTEM_ENV),
                abdicator,
                city,
                nation,
                { destGeneralID: recipient.id },
                { destGeneral: recipient }
            ).logs
        );
        expect(
            abdicationLogs
                .filter((log) => log.generalId === recipient.id)
                .map((log) => [log.category, log.legacyFlushGroup])
        ).toEqual([
            [LogCategory.HISTORY, 1],
            [LogCategory.ACTION, 1],
        ]);

        const giver = makeGeneral({ id: 1, nationId: 1, cityId: 1, name: '증여자', gold: 1300 });
        const receiver = makeGeneral({ id: 2, nationId: 1, cityId: 1, name: '수령자', gold: 200 });
        const giftLogs = orderLegacyActionLoggerFlush(
            resolveForLogOrdering(
                giftSpec.createDefinition(SYSTEM_ENV),
                giver,
                city,
                nation,
                { isGold: true, amount: 500, destGeneralID: receiver.id },
                { destGeneral: receiver }
            ).logs
        );
        expect(giftLogs.map((log) => [log.generalId, log.legacyFlushGroup ?? 0])).toEqual([
            [giver.id, 0],
            [receiver.id, 1],
        ]);

        const disbandActor = makeGeneral({ id: 10, nationId: 1, cityId: 1, name: '방랑군주', officerLevel: 12 });
        const member2 = makeGeneral({ id: 2, nationId: 1, cityId: 1, name: '부하2' });
        const member3 = makeGeneral({ id: 3, nationId: 1, cityId: 1, name: '부하3' });
        const wanderingNation = makeNation({
            id: 1,
            name: '방랑군',
            chiefGeneralId: disbandActor.id,
            capitalCityId: 1,
            level: 0,
            typeCode: 'None',
        });
        const disbandLogs = orderLegacyActionLoggerFlush(
            resolveForLogOrdering(
                disbandSpec.createDefinition(SYSTEM_ENV),
                disbandActor,
                city,
                wanderingNation,
                {},
                {
                    nationGenerals: [disbandActor, member3, member2],
                    nationCities: [city],
                    currentYearMonth: 201 * 12 + 2 - 1,
                    initYearMonth: 201 * 12 + 1 - 1,
                }
            ).logs
        );
        const nonActorDestructionLogs = disbandLogs.filter(
            (log) =>
                log.scope === LogScope.GENERAL && log.generalId !== disbandActor.id && log.text.includes('<R>멸망</>')
        );
        expect(nonActorDestructionLogs.map((log) => [log.generalId, log.category, log.legacyFlushGroup])).toEqual([
            [member2.id, LogCategory.HISTORY, -2],
            [member2.id, LogCategory.ACTION, -2],
            [member3.id, LogCategory.HISTORY, -1],
            [member3.id, LogCategory.ACTION, -1],
        ]);
        const actorLogs = disbandLogs.filter(
            (log) => log.scope === LogScope.GENERAL && log.generalId === disbandActor.id
        );
        expect(actorLogs).toHaveLength(4);
        expect(actorLogs.every((log) => (log.legacyFlushGroup ?? 0) === 0)).toBe(true);
    });

    it('선양·모반시도의 Ref logger format과 거병 중립 nation flush 계약을 보존한다', () => {
        const city = makeCity({ id: 1, nationId: 1 });
        const nation = makeNation({ id: 1, name: '위', chiefGeneralId: 1, capitalCityId: 1 });
        const projectRoute = (logs: ReturnType<typeof orderLegacyActionLoggerFlush>) =>
            logs.map((log) => [
                log.scope,
                log.category,
                log.generalId ?? null,
                log.nationId ?? null,
                log.format,
                log.legacyFlushGroup ?? 0,
            ]);

        const rebel = makeGeneral({ id: 2, nationId: 1, cityId: 1, name: '중신', officerLevel: 2 });
        const displacedLord = makeGeneral({
            id: 1,
            nationId: 1,
            cityId: 1,
            name: '군주',
            officerLevel: 12,
            experience: 1_000,
        });
        const rebellionLogs = orderLegacyActionLoggerFlush(
            resolveForLogOrdering(
                rebellionSpec.createDefinition(SYSTEM_ENV),
                rebel,
                city,
                nation,
                {},
                { nationGenerals: [displacedLord, rebel] }
            ).logs
        );
        expect(projectRoute(rebellionLogs)).toEqual([
            [LogScope.GENERAL, LogCategory.HISTORY, rebel.id, null, LogFormat.YEAR_MONTH, 0],
            [LogScope.GENERAL, LogCategory.ACTION, rebel.id, null, LogFormat.MONTH, 0],
            [LogScope.NATION, LogCategory.HISTORY, null, nation.id, LogFormat.YEAR_MONTH, 0],
            [LogScope.SYSTEM, LogCategory.HISTORY, null, null, LogFormat.YEAR_MONTH, 0],
            [LogScope.GENERAL, LogCategory.HISTORY, displacedLord.id, null, LogFormat.YEAR_MONTH, 1],
            [LogScope.GENERAL, LogCategory.ACTION, displacedLord.id, null, LogFormat.MONTH, 1],
        ]);

        const abdicator = makeGeneral({ id: 1, nationId: 1, cityId: 1, name: '군주', officerLevel: 12 });
        const recipient = makeGeneral({ id: 2, nationId: 1, cityId: 1, name: '후계자' });
        const abdicationLogs = orderLegacyActionLoggerFlush(
            resolveForLogOrdering(
                abdicationSpec.createDefinition(SYSTEM_ENV),
                abdicator,
                city,
                nation,
                { destGeneralID: recipient.id },
                { destGeneral: recipient }
            ).logs
        );
        expect(projectRoute(abdicationLogs)).toEqual([
            [LogScope.GENERAL, LogCategory.HISTORY, abdicator.id, null, LogFormat.YEAR_MONTH, 0],
            [LogScope.GENERAL, LogCategory.ACTION, abdicator.id, null, LogFormat.MONTH, 0],
            [LogScope.NATION, LogCategory.HISTORY, null, nation.id, LogFormat.YEAR_MONTH, 0],
            [LogScope.SYSTEM, LogCategory.HISTORY, null, null, LogFormat.YEAR_MONTH, 0],
            [LogScope.GENERAL, LogCategory.HISTORY, recipient.id, null, LogFormat.YEAR_MONTH, 1],
            [LogScope.GENERAL, LogCategory.ACTION, recipient.id, null, LogFormat.MONTH, 1],
        ]);

        const founder = makeGeneral({ id: 7, nationId: 0, cityId: 1, name: '운영자' });
        const uprisingLogs = orderLegacyActionLoggerFlush(
            resolveForLogOrdering(
                uprisingSpec.createDefinition(SYSTEM_ENV),
                founder,
                city,
                null,
                {},
                {
                    createNationId: () => 2,
                    listNations: () => [],
                    scenarioId: 1,
                    baseRice: 1_000,
                }
            ).logs
        );
        expect(projectRoute(uprisingLogs)).toEqual([
            [LogScope.GENERAL, LogCategory.HISTORY, founder.id, null, LogFormat.YEAR_MONTH, 0],
            [LogScope.GENERAL, LogCategory.ACTION, founder.id, null, LogFormat.MONTH, 0],
            [LogScope.SYSTEM, LogCategory.HISTORY, null, null, LogFormat.YEAR_MONTH, 0],
            [LogScope.SYSTEM, LogCategory.SUMMARY, null, null, LogFormat.MONTH, 0],
        ]);
        expect(uprisingLogs.some((log) => log.scope === LogScope.NATION)).toBe(false);
    });

    it('cr_건국: 국가 정보를 건국 상태로 갱신한다', async () => {
        const lord = makeGeneral({
            id: 1,
            nationId: 1,
            cityId: 1,
            name: '건국자',
            officerLevel: 12,
            experience: 200,
            dedication: 300,
        });
        const follower = makeGeneral({ id: 2, nationId: 1, cityId: 1, name: '추종자', officerLevel: 1 });
        const nation = makeNation({
            id: 1,
            name: '옛국가',
            chiefGeneralId: 1,
            capitalCityId: null,
            level: 0,
            typeCode: 'None',
            meta: { gennum: 2 },
        });
        const city = makeCity({ id: 1, nationId: 0, level: 5 });

        const world = new InMemoryWorld(
            makeSnapshot({ generals: [lord, follower], nations: [nation], cities: [city], startYear: 200 })
        );
        const runner = new TestGameRunner(world, 201, 1);

        await runner.runTurn([
            {
                generalId: lord.id,
                commandKey: 'cr_건국',
                resolver: foundNationSpec.createDefinition(SYSTEM_ENV),
                args: { nationName: '신국', nationType: 'che_도적', colorType: 1 },
                context: {
                    currentYearMonth: 201 * 12,
                    initYearMonth: 200 * 12,
                },
            },
        ]);

        const updatedNation = world.getNation(1)!;
        const updatedLord = world.getGeneral(1)!;
        expect(updatedNation.name).toBe('신국');
        expect(updatedNation.level).toBe(1);
        expect(updatedNation.capitalCityId).toBe(1);
        expect(world.getCity(1)!.nationId).toBe(1);
        expect(updatedLord.experience).toBe(1200);
        expect(updatedLord.dedication).toBe(1300);
    });

    it('che_장비매매: 동일 장비 재구매는 AlwaysFail 제약으로 막는다', () => {
        const general = makeGeneral({
            id: 10,
            nationId: 1,
            cityId: 1,
            gold: 5000,
            items: { weapon: 'testSword' },
        });
        const city = makeCity({ id: 1, nationId: 1, level: 5 });
        const nation = makeNation({ id: 1, level: 1, chiefGeneralId: 10, capitalCityId: 1 });

        const itemCatalog: Record<string, TurnCommandItemCatalogEntry> = {
            testSword: {
                slot: 'weapon',
                name: '테스트검',
                rawName: '테스트검',
                cost: 500,
                reqSecu: 0,
                buyable: true,
                unique: false,
            },
        };

        const definition = tradeItemSpec.createDefinition({
            ...SYSTEM_ENV,
            itemCatalog,
        });
        const args = { itemType: 'weapon' as const, itemCode: 'testSword' };

        const context: ConstraintContext = {
            actorId: general.id,
            cityId: city.id,
            nationId: nation.id,
            args,
            env: {},
            mode: 'full',
        };

        const view: StateView = {
            has: (req: RequirementKey) => {
                if (req.kind === 'general') return req.id === general.id;
                if (req.kind === 'city') return req.id === city.id;
                if (req.kind === 'nation') return req.id === nation.id;
                return false;
            },
            get: (req: RequirementKey) => {
                if (req.kind === 'general' && req.id === general.id) return general;
                if (req.kind === 'city' && req.id === city.id) return city;
                if (req.kind === 'nation' && req.id === nation.id) return nation;
                return null;
            },
        };

        const result = evaluateActionConstraints(definition, context, view, args);
        expect(result.kind).toBe('deny');
        if (result.kind === 'deny') {
            expect(result.constraintName).toBe('AlwaysFail');
        }
    });
});
