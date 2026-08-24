import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRecord, normalizeArchivedGeneral, RANK_DATA_TYPES, type ArchivedJsonValue } from '@sammo-ts/common';
import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';
import { LogCategory, LogScope } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import type { GeneralLifecycleEvent } from '../src/turn/inMemoryWorld.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { InMemoryTurnProcessor } from '../src/turn/inMemoryTurnProcessor.js';
import { persistGeneralLifecycleEvents } from '../src/turn/generalTurnLifecyclePersistence.js';
import { createReservedTurnHandler } from '../src/turn/reservedTurnHandler.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { loadTurnWorldFromDatabase } from '../src/turn/worldLoader.js';

const databaseUrl = process.env.GENERAL_LIFECYCLE_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const generalIds = [990_001, 990_002, 990_003, 990_004, 990_005, 990_006, 990_007];
const userIds = [
    'integration-lifecycle-dead',
    'integration-lifecycle-retired',
    'integration-lifecycle-possessed',
    'integration-lifecycle-explicit-retired',
    'integration-lifecycle-automatic-retired',
    'integration-lifecycle-death-archive',
    'integration-lifecycle-retire-before-unification',
];
const serverId = 'lifecycle-int';
const sameFlushServerId = `${serverId}-retire-before-unification`;
const worldId = 990_004;
const deathArchiveWorldId = 990_006;
const sameFlushWorldId = 990_007;
const nationId = 990_004;
const cityId = 990_004;
const sameFlushNationId = 990_007;
const sameFlushCityId = 990_007;
const archiveServerIds = [serverId, sameFlushServerId];
const historyServerIds = [serverId, `${serverId}-completed`, `${serverId}-abandoned`, sameFlushServerId];

const makeGeneral = (id: number, userId: string, patch: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id,
    userId,
    name: `lifecycle-${id}`,
    nationId: 0,
    cityId: 0,
    troopId: 0,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    experience: 1_000,
    dedication: 800,
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
    crewTypeId: 1,
    train: 0,
    atmos: 0,
    age: 80,
    npcState: 0,
    bornYear: 170,
    deadYear: 260,
    affinity: 50,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: {
        killturn: 0,
        inherit_lived_month: 10,
        inherit_active_action: 2,
        dex1: 1_000,
    },
    turnTime: new Date('0200-01-01T00:00:00.000Z'),
    ...patch,
});

const event = (general: TurnGeneral, outcome: GeneralLifecycleEvent['outcome']): GeneralLifecycleEvent => ({
    generalId: general.id,
    outcome,
    before: general,
    ...(outcome === 'deleted' ? {} : { after: general }),
    year: 200,
    month: 1,
});

integration('general turn lifecycle persistence', () => {
    let db: GamePrismaClient;
    let close: (() => Promise<void>) | undefined;

    const cleanup = async () => {
        await db.logEntry.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.generalAccessLog.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.generalTurnRevision.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.generalTurn.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.rankData.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.unificationFinalization.deleteMany({ where: { serverId: sameFlushServerId } });
        await db.emperor.deleteMany({ where: { serverId: sameFlushServerId } });
        await db.oldNation.deleteMany({ where: { serverId: sameFlushServerId } });
        await db.oldGeneral.deleteMany({
            where: { serverId: { in: archiveServerIds }, generalNo: { in: generalIds } },
        });
        await db.hallOfFame.deleteMany({
            where: { serverId: { in: archiveServerIds }, generalNo: { in: generalIds } },
        });
        await db.inheritanceResult.deleteMany({
            where: { serverId: { in: archiveServerIds }, owner: { in: userIds } },
        });
        await db.inheritanceLog.deleteMany({ where: { userId: { in: userIds } } });
        await db.inheritancePoint.deleteMany({ where: { userId: { in: userIds } } });
        await db.general.deleteMany({ where: { id: { in: generalIds } } });
        await db.city.deleteMany({ where: { id: { in: [cityId, sameFlushCityId] } } });
        await db.nation.deleteMany({ where: { id: { in: [nationId, sameFlushNationId] } } });
        await db.worldState.deleteMany({
            where: { id: { in: [worldId, deathArchiveWorldId, sameFlushWorldId] } },
        });
        await db.gameHistory.deleteMany({ where: { serverId: { in: historyServerIds } } });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
        await cleanup();
    });

    afterAll(async () => {
        await cleanup();
        await close?.();
    });

    it('archives deletion, removes access state, and settles inheritance', async () => {
        const general = makeGeneral(generalIds[0]!, userIds[0]!, {
            meta: {
                killturn: 0,
                inherit_lived_month: 10,
                inherit_active_action: 2,
                max_belong: 9,
                inheritRandomUnique: true,
                dex1: 1_000,
                dex2: 1,
                dex3: 1,
                dex4: 1,
                dex5: 1,
                betwin: 2,
                betgold: 2_000,
                betwingold: 1_000,
            },
        });
        await db.generalAccessLog.create({
            data: { generalId: general.id, userId: general.userId, refreshScore: 99 },
        });
        await db.inheritancePoint.createMany({
            data: [
                { userId: general.userId!, key: 'previous', value: 100 },
                { userId: general.userId!, key: 'max_domestic_critical', value: 80 },
                { userId: general.userId!, key: 'unifier', value: 250 },
                { userId: general.userId!, key: 'tournament', value: 50 },
            ],
        });
        await db.rankData.createMany({
            data: [
                { generalId: general.id, nationId: 0, type: 'warnum', value: 2 },
                { generalId: general.id, nationId: 0, type: 'firenum', value: 1 },
                { generalId: general.id, nationId: 0, type: 'killnum', value: 1 },
                { generalId: general.id, nationId: 0, type: 'deathnum', value: 1 },
                { generalId: general.id, nationId: 0, type: 'killcrew', value: 400 },
                { generalId: general.id, nationId: 0, type: 'deathcrew', value: 300 },
            ],
        });
        await db.logEntry.createMany({
            data: [
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.HISTORY,
                    year: 199,
                    month: 12,
                    generalId: general.id,
                    text: '<C>●</>첫 기록',
                },
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.HISTORY,
                    year: 200,
                    month: 1,
                    generalId: general.id,
                    text: '<Y>●</>둘째 기록',
                },
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    year: 200,
                    month: 1,
                    generalId: general.id,
                    text: '보존하지 않을 개인 기록',
                },
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.BATTLE_DETAIL,
                    year: 200,
                    month: 1,
                    generalId: general.id,
                    text: '보존하지 않을 전투 기록',
                },
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.BATTLE_BRIEF,
                    year: 200,
                    month: 1,
                    generalId: general.id,
                    text: '보존할 전투 결과',
                },
            ],
        });

        await db.$transaction((tx) =>
            persistGeneralLifecycleEvents(
                tx,
                [event(general, 'deleted')],
                { serverId },
                { inheritItemRandomPoint: 3_000, inheritSpecificSpecialPoint: 4_000 }
            )
        );

        expect(await db.generalAccessLog.findUnique({ where: { generalId: general.id } })).toBeNull();
        const archived = await db.oldGeneral.findUniqueOrThrow({
            where: { by_no: { serverId, generalNo: general.id } },
        });
        const archivedData = asRecord(archived.data);
        expect(archivedData.history).toEqual(['<Y>●</>둘째 기록', '<C>●</>첫 기록']);
        expect(asRecord(archivedData.meta)).toMatchObject({ inheritRandomUnique: true });
        const snapshot = normalizeArchivedGeneral(archived.data as ArchivedJsonValue, archived.name).snapshot;
        expect(snapshot).toMatchObject({
            mastery: { infantry: 1_000, archery: 1, cavalry: 1, special: 1, siege: 1 },
            battle: {
                battles: 2,
                wins: 1,
                losses: 1,
                fireSuccesses: 1,
                killedCrew: 400,
                lostCrew: 300,
            },
            records: { battleResult: ['보존할 전투 결과'] },
            availability: { battleResultLogs: true, battleDetailLogs: false },
        });
        expect(JSON.stringify(archived.data)).not.toContain('보존하지 않을 개인 기록');
        expect(JSON.stringify(archived.data)).not.toContain('보존하지 않을 전투 기록');
        expect(
            await db.inheritancePoint.findUnique({
                where: { userId_key: { userId: general.userId!, key: 'previous' } },
            })
        ).toMatchObject({ value: 3_622 });
        expect(
            (
                await db.inheritanceLog.findMany({
                    where: { userId: general.userId! },
                    orderBy: { id: 'asc' },
                    select: { text: true },
                })
            ).map(({ text }) => text)
        ).toEqual([
            '사망으로 랜덤 유니크 구입 3000 포인트 반환',
            '기존 보유 포인트 3100 증가',
            '최대 임관년 수 포인트 90 증가',
            '최대 연속 내정 성공 포인트 80 증가',
            '전투 횟수 포인트 10 증가',
            '계략 성공 횟수 포인트 20 증가',
            '천통 기여 포인트 250 증가',
            '숙련도 포인트 1.004 증가',
            '토너먼트 포인트 50 증가',
            '베팅 당첨 포인트 5 증가',
            '포인트 3100 => 3622',
        ]);
    });

    it('resets access/ranks and records pre-rebirth hall and inheritance values', async () => {
        const general = makeGeneral(generalIds[1]!, userIds[1]!, {
            meta: {
                killturn: 0,
                inherit_lived_month: 10,
                inherit_active_action: 2,
                max_domestic_critical: 20,
                max_belong: 7,
                dex1: 1_000,
                betwin: 2,
                betgold: 2_000,
                betwingold: 1_000,
            },
        });
        await db.generalAccessLog.create({
            data: { generalId: general.id, userId: general.userId, refreshScore: 77 },
        });
        await db.inheritancePoint.createMany({
            data: [
                { userId: general.userId!, key: 'previous', value: 50 },
                { userId: general.userId!, key: 'max_domestic_critical', value: 80 },
                { userId: general.userId!, key: 'unifier', value: 250 },
                { userId: general.userId!, key: 'tournament', value: 50 },
            ],
        });
        await db.rankData.create({
            data: { generalId: general.id, nationId: 0, type: 'warnum', value: 10 },
        });
        await db.rankData.create({
            data: { generalId: general.id, nationId: 0, type: 'inherit_earned', value: 4_321 },
        });

        const retirementEvent = event(general, 'retired');
        retirementEvent.after = {
            ...general,
            meta: { ...general.meta, rank_warnum: 0, inherit_earned: 0 },
        };
        await db.$transaction((tx) =>
            persistGeneralLifecycleEvents(
                tx,
                [retirementEvent],
                { serverId, season: 1, scenarioId: 2, isUnited: 0 },
                {}
            )
        );

        expect(await db.generalAccessLog.findUnique({ where: { generalId: general.id } })).toMatchObject({
            refreshScore: 0,
        });
        expect(
            await db.rankData.findUnique({ where: { generalId_type: { generalId: general.id, type: 'warnum' } } })
        ).toMatchObject({ value: 0 });
        expect(
            await db.hallOfFame.findUnique({
                where: {
                    serverId_type_generalNo: {
                        serverId,
                        type: 'experience',
                        generalNo: general.id,
                    },
                },
            })
        ).toMatchObject({ value: 1_000 });
        expect(
            await db.hallOfFame.findUnique({
                where: {
                    serverId_type_generalNo: {
                        serverId,
                        type: 'inherit_earned',
                        generalNo: general.id,
                    },
                },
            })
        ).toMatchObject({ value: 4_321 });
        expect(
            await db.inheritancePoint.findUnique({
                where: { userId_key: { userId: general.userId!, key: 'previous' } },
            })
        ).toMatchObject({ value: 171 });
        expect(
            await db.inheritancePoint.findMany({
                where: { userId: general.userId! },
                orderBy: { key: 'asc' },
                select: { key: true, value: true },
            })
        ).toEqual([
            { key: 'max_belong', value: 70 },
            { key: 'max_domestic_critical', value: 80 },
            { key: 'previous', value: 171 },
            { key: 'unifier', value: 250 },
        ]);
    });

    it('archives the death turn history and battle brief through execute and database flush', async () => {
        const general = makeGeneral(generalIds[5]!, userIds[5]!, {
            npcState: 2,
            turnTime: new Date('0200-01-01T00:00:00.000Z'),
        });
        const scenarioConfig = {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
            iconPath: '.',
            map: {},
            const: { killturn: 0 },
            environment: { mapName: 'che', unitSet: 'che' },
        };
        const scenarioMeta = {
            title: '사망 기록 archive integration',
            startYear: 200,
            life: null,
            fiction: 0,
            history: [],
            ignoreDefaultEvents: false,
        };
        const worldMeta = { serverId, killturn: 0, scenarioMeta };
        await db.worldState.create({
            data: {
                id: deathArchiveWorldId,
                scenarioCode: 'death-archive-integration',
                currentYear: 200,
                currentMonth: 1,
                tickSeconds: 600,
                config: scenarioConfig as GamePrisma.InputJsonValue,
                meta: worldMeta as GamePrisma.InputJsonValue,
            },
        });
        await db.general.create({
            data: {
                id: general.id,
                userId: general.userId,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                npcState: general.npcState,
                leadership: general.stats.leadership,
                strength: general.stats.strength,
                intel: general.stats.intelligence,
                experience: general.experience,
                dedication: general.dedication,
                officerLevel: general.officerLevel,
                injury: general.injury,
                gold: general.gold,
                rice: general.rice,
                crew: general.crew,
                crewTypeId: general.crewTypeId,
                train: general.train,
                atmos: general.atmos,
                turnTime: general.turnTime,
                age: general.age,
                bornYear: general.bornYear,
                deadYear: general.deadYear,
                meta: general.meta as GamePrisma.InputJsonValue,
            },
        });
        await db.logEntry.createMany({
            data: [
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.HISTORY,
                    year: 199,
                    month: 12,
                    generalId: general.id,
                    text: '이전 열전',
                },
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.BATTLE_BRIEF,
                    year: 199,
                    month: 12,
                    generalId: general.id,
                    text: '이전 전투 결과',
                },
            ],
        });
        const state: TurnWorldState = {
            id: deathArchiveWorldId,
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: general.turnTime,
            meta: worldMeta,
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig,
            scenarioMeta,
            map: {
                id: 'death-archive',
                name: '사망 기록 archive',
                cities: [],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            },
            generals: [general],
            nations: [],
            cities: [],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            generalTurnHandler: {
                execute: ({ general: currentGeneral, world: currentWorld }) => ({
                    deleted: { general: true },
                    lifecycleEvent: {
                        generalId: currentGeneral.id,
                        outcome: 'deleted',
                        before: currentGeneral,
                        year: currentWorld.currentYear,
                        month: currentWorld.currentMonth,
                    },
                    logs: [
                        {
                            scope: LogScope.GENERAL,
                            category: LogCategory.HISTORY,
                            generalId: currentGeneral.id,
                            text: '마지막 열전 첫째',
                        },
                        {
                            scope: LogScope.GENERAL,
                            category: LogCategory.BATTLE_BRIEF,
                            generalId: currentGeneral.id,
                            text: '마지막 전투 결과 첫째',
                        },
                        {
                            scope: LogScope.GENERAL,
                            category: LogCategory.HISTORY,
                            generalId: currentGeneral.id,
                            text: '마지막 열전 둘째',
                        },
                        {
                            scope: LogScope.GENERAL,
                            category: LogCategory.BATTLE_BRIEF,
                            generalId: currentGeneral.id,
                            text: '마지막 전투 결과 둘째',
                        },
                    ],
                }),
            },
        });

        world.executeGeneralTurn(world.getGeneralById(general.id)!);
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            await hooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 1,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });
        } finally {
            await hooks.close();
        }

        const archived = await db.oldGeneral.findUniqueOrThrow({
            where: { by_no: { serverId, generalNo: general.id } },
        });
        const archivedData = asRecord(archived.data);
        expect(archivedData.history).toEqual(['마지막 열전 둘째', '마지막 열전 첫째', '이전 열전']);
        expect(asRecord(archivedData.records).battleResult).toEqual([
            '마지막 전투 결과 둘째',
            '마지막 전투 결과 첫째',
            '이전 전투 결과',
        ]);
        await expect(
            db.logEntry.count({
                where: {
                    generalId: general.id,
                    category: { in: [LogCategory.HISTORY, LogCategory.BATTLE_BRIEF] },
                },
            })
        ).resolves.toBe(6);
    });

    it('settles a pre-month retirement before same-flush unification without losing Hall or repaying stored points', async () => {
        const turnTime = new Date('0200-01-01T00:05:00.000Z');
        const monthBoundary = new Date('0200-01-01T00:10:00.000Z');
        const general = makeGeneral(generalIds[6]!, userIds[6]!, {
            nationId: sameFlushNationId,
            cityId: sameFlushCityId,
            age: 80,
            officerLevel: 1,
            turnTime,
            meta: {
                killturn: 24,
                owner_name: '월경계 은퇴 사용자',
                rank_warnum: 11,
                firenum: 2,
                inherit_lived_month: 10,
                inherit_active_action: 4,
                dex1: 200,
                dex2: 0,
                dex3: 0,
                dex4: 0,
                dex5: 0,
                event100_allstar: { granted: { dex1: 80 } },
            },
            inheritancePoints: {
                previous: 100,
                lived_month: 10,
                active_action: 4,
                tournament: 11,
            },
        });
        const scenarioConfig = {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
            iconPath: '.',
            map: {},
            const: {
                retirementYear: 80,
                minPushHallAge: 30,
                incDefSettingChange: 3,
                maxDefSettingChange: 9,
            },
            environment: { mapName: 'che', unitSet: 'che' },
        };
        const scenarioMeta = {
            title: '월경계 은퇴 후 통일 integration',
            startYear: 200,
            life: null,
            fiction: 0,
            history: [],
            ignoreDefaultEvents: false,
        };
        const worldMeta = {
            serverId: sameFlushServerId,
            serverName: '월경계 서버',
            season: 9,
            scenarioId: 77,
            gameIdx: 12,
            isUnited: 0,
            isunited: 0,
            killturn: 24,
            scenarioMeta,
        };
        const nation = {
            id: sameFlushNationId,
            name: '월경계국',
            color: '#224466',
            capitalCityId: sameFlushCityId,
            chiefGeneralId: general.id,
            gold: 10_000,
            rice: 10_000,
            power: 1_000,
            level: 1,
            typeCode: 'che_중립',
            meta: { gennum: 1, tech: 0 },
        };
        const city = {
            id: sameFlushCityId,
            name: '월경계성',
            nationId: sameFlushNationId,
            level: 5,
            state: 0,
            population: 10_000,
            populationMax: 20_000,
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
            meta: { trust: 50, trade: 100, region: 1 },
        };
        const map = {
            id: 'retire-before-unification',
            name: '월경계 은퇴 후 통일',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        };
        await db.worldState.create({
            data: {
                id: sameFlushWorldId,
                scenarioCode: 'retire-before-unification-integration',
                currentYear: 200,
                currentMonth: 1,
                tickSeconds: 600,
                config: scenarioConfig as GamePrisma.InputJsonValue,
                meta: worldMeta as GamePrisma.InputJsonValue,
            },
        });
        await db.nation.create({
            data: {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                capitalCityId: nation.capitalCityId,
                chiefGeneralId: nation.chiefGeneralId,
                gold: nation.gold,
                rice: nation.rice,
                tech: 0,
                level: nation.level,
                typeCode: nation.typeCode,
                meta: nation.meta,
            },
        });
        await db.city.create({
            data: {
                id: city.id,
                name: city.name,
                nationId: city.nationId,
                level: city.level,
                population: city.population,
                populationMax: city.populationMax,
                agriculture: city.agriculture,
                agricultureMax: city.agricultureMax,
                commerce: city.commerce,
                commerceMax: city.commerceMax,
                security: city.security,
                securityMax: city.securityMax,
                defence: city.defence,
                defenceMax: city.defenceMax,
                wall: city.wall,
                wallMax: city.wallMax,
                supplyState: city.supplyState,
                frontState: city.frontState,
                region: 1,
                meta: city.meta,
            },
        });
        await db.general.create({
            data: {
                id: general.id,
                userId: general.userId,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                npcState: general.npcState,
                leadership: general.stats.leadership,
                strength: general.stats.strength,
                intel: general.stats.intelligence,
                experience: general.experience,
                dedication: general.dedication,
                officerLevel: general.officerLevel,
                injury: general.injury,
                gold: general.gold,
                rice: general.rice,
                crew: general.crew,
                crewTypeId: general.crewTypeId,
                train: general.train,
                atmos: general.atmos,
                turnTime: general.turnTime,
                age: general.age,
                bornYear: general.bornYear,
                deadYear: general.deadYear,
                meta: general.meta as GamePrisma.InputJsonValue,
            },
        });
        await db.rankData.createMany({
            data: RANK_DATA_TYPES.map((type) => ({
                generalId: general.id,
                nationId: general.nationId,
                type,
                value: type === 'warnum' ? 11 : type === 'firenum' ? 2 : 0,
            })),
        });
        await db.inheritancePoint.createMany({
            data: [
                { userId: general.userId!, key: 'previous', value: 100 },
                { userId: general.userId!, key: 'lived_month', value: 10 },
                { userId: general.userId!, key: 'active_action', value: 4 },
                { userId: general.userId!, key: 'tournament', value: 11 },
            ],
        });
        await db.gameHistory.create({
            data: {
                serverId: sameFlushServerId,
                date: new Date('0200-01-01T00:00:00.000Z'),
                season: 9,
                scenario: 77,
                scenarioName: scenarioMeta.title,
                status: 'OPEN',
            },
        });

        const reservedTurns = new InMemoryReservedTurnStore(db, { maxGeneralTurns: 3, maxNationTurns: 3 });
        await reservedTurns.loadAll();
        reservedTurns.setGeneralTurn(general.id, 0, { action: '휴식', args: {} });
        const state: TurnWorldState = {
            id: sameFlushWorldId,
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
            meta: worldMeta,
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig,
            scenarioMeta,
            map,
            generals: [general],
            nations: [nation],
            cities: [city],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };
        let world: InMemoryTurnWorld | null = null;
        const handler = await createReservedTurnHandler({
            reservedTurns,
            scenarioConfig,
            scenarioMeta,
            map,
            getWorld: () => world,
        });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            generalTurnHandler: handler,
            calendarHandler: {
                onMonthChanged: (context) => {
                    if (!world) throw new Error('world is unavailable');
                    const reborn = world.getGeneralById(general.id);
                    if (!reborn?.userId) throw new Error('reborn general is unavailable');
                    world.queueInheritancePointAdjustment(reborn.userId, 'unifier', 250, 'after_lifecycle');
                    world.updateGeneral(reborn.id, {
                        inheritancePoints: {
                            ...reborn.inheritancePoints,
                            unifier: (reborn.inheritancePoints?.unifier ?? 0) + 250,
                        },
                    });
                    world.updateWorldMeta({ isUnited: 2, isunited: 2 });
                    world.queueUnificationFinalization({
                        generationKey: `unification:${sameFlushServerId}`,
                        serverId: sameFlushServerId,
                        profileName: 'che',
                        winnerNationId: sameFlushNationId,
                        year: context.currentYear,
                        month: context.currentMonth,
                        completedAt: new Date(context.turnTime.getTime()),
                        auctionCancellations: [],
                    });
                },
            },
        });
        world.advanceGameClockTo(monthBoundary, monthBoundary);
        const processor = new InMemoryTurnProcessor(world);
        const result = await processor.run(monthBoundary, {
            budgetMs: 10_000,
            maxGenerals: 10,
            catchUpCap: 1,
        });
        expect(result).toMatchObject({ processedGenerals: 1, processedTurns: 1, partial: false });
        expect(world.getState().meta).toMatchObject({ isUnited: 2, isunited: 2 });
        expect(world.peekDirtyState().lifecycleEvents).toContainEqual(
            expect.objectContaining({
                generalId: general.id,
                outcome: 'retired',
                isUnitedAtEvent: 0,
            })
        );
        expect(world.getGeneralById(general.id)).toMatchObject({
            age: 20,
            inheritancePoints: { tournament: 11, lived_month: 11, active_action: 4 },
            meta: { rank_warnum: 0, inherit_lived_month: 0, inherit_active_action: 0, dex1: 100 },
        });

        const hooks = await createDatabaseTurnHooks(databaseUrl!, world, { reservedTurns, profileName: 'che' });
        try {
            await hooks.hooks.flushChanges?.(result);
        } finally {
            await hooks.close();
        }

        await expect(
            db.hallOfFame.findUniqueOrThrow({
                where: {
                    serverId_type_generalNo: {
                        serverId: sameFlushServerId,
                        type: 'warnum',
                        generalNo: general.id,
                    },
                },
            })
        ).resolves.toMatchObject({ value: 11 });
        const dexHall = await db.hallOfFame.findUniqueOrThrow({
            where: {
                serverId_type_generalNo: {
                    serverId: sameFlushServerId,
                    type: 'dex1',
                    generalNo: general.id,
                },
            },
        });
        expect(dexHall).toMatchObject({ value: 120 });
        expect(asRecord(dexHall.aux)).toMatchObject({ unitedTime: monthBoundary.toISOString() });

        const results = await db.inheritanceResult.findMany({
            where: { serverId: sameFlushServerId, owner: general.userId! },
            orderBy: { id: 'asc' },
            select: { value: true },
        });
        expect(results).toHaveLength(2);
        const rebirth = asRecord(results[0]!.value);
        const unification = asRecord(results[1]!.value);
        expect(rebirth).toMatchObject({ rebirth: true, tournament: 11 });
        expect(asRecord(rebirth.retained)).toMatchObject({ unifier: 0 });
        expect(unification).toMatchObject({
            generationKey: `unification:${sameFlushServerId}`,
            previous: rebirth.total,
            lived_month: 0,
            active_action: 0,
            tournament: 0,
            unifier: 250,
            unifierBeforeAward: 250,
            unifierAward: 0,
        });
        await expect(
            db.inheritancePoint.findUniqueOrThrow({
                where: { userId_key: { userId: general.userId!, key: 'previous' } },
            })
        ).resolves.toMatchObject({ value: Math.floor(Number(unification.total)) });
    });

    it('does not settle a possessed NPC before the legacy minimum possession period', async () => {
        const general = makeGeneral(generalIds[2]!, userIds[2]!, {
            npcState: 1,
            meta: {
                killturn: 0,
                inherit_lived_month: 10,
                inherit_active_action: 2,
                pickYearMonth: 190 * 12,
            },
        });
        await db.inheritancePoint.create({
            data: { userId: general.userId!, key: 'previous', value: 100 },
        });

        await db.$transaction((tx) =>
            persistGeneralLifecycleEvents(tx, [event(general, 'deleted')], { serverId, startYear: 180 }, {})
        );

        expect(
            await db.inheritancePoint.findUnique({
                where: { userId_key: { userId: general.userId!, key: 'previous' } },
            })
        ).toMatchObject({ value: 100 });
        expect(
            await db.inheritanceResult.count({
                where: { serverId, owner: general.userId! },
            })
        ).toBe(0);
    });

    it('executes explicit retirement, flushes pre-reset settlement values, and reloads only the reborn state', async () => {
        const general = makeGeneral(generalIds[3]!, userIds[3]!, {
            nationId,
            cityId,
            age: 65,
            experience: 1_001,
            dedication: 801,
            turnTime: new Date('0200-01-01T00:10:00.000Z'),
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: 'che_무기_12_칠성검', book: null, item: null },
            },
            meta: {
                killturn: 24,
                rank_warnum: 11,
                firenum: 9,
                inherit_earned: 4_321,
                inherit_lived_month: 10,
                inherit_active_action: 4,
                inheritRandomUnique: 1,
                inherit_spent_dyn: 3_000,
                dex1: 200,
                dex2: 0,
                dex3: 0,
                dex4: 0,
                dex5: 0,
                event100_allstar: { granted: { dex1: 80 } },
            },
            inheritancePoints: { previous: 50, lived_month: 10, active_action: 4 },
        });
        const automaticGeneral = makeGeneral(generalIds[4]!, userIds[4]!, {
            nationId,
            cityId,
            age: 80,
            crew: 100,
            turnTime: new Date('0200-01-01T00:00:00.000Z'),
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: 'che_무기_12_칠성검', book: null, item: null },
            },
            meta: {
                killturn: 24,
                rank_warnum: 6,
                inherit_lived_month: 10,
                inherit_active_action: 4,
                inheritRandomUnique: 1,
                inherit_spent_dyn: 3_000,
                dex1: 40,
            },
            inheritancePoints: { previous: 70, lived_month: 10, active_action: 4 },
        });
        const scenarioConfig = {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
            iconPath: '.',
            map: {},
            const: {
                retirementYear: 80,
                incDefSettingChange: 3,
                maxDefSettingChange: 9,
                inheritItemRandomPoint: 3_000,
                allItems: { weapon: { che_무기_12_칠성검: 1 } },
            },
            environment: { mapName: 'che', unitSet: 'che' },
        };
        const scenarioMeta = {
            title: '명시적 은퇴 integration',
            startYear: 200,
            life: null,
            fiction: 0,
            history: [],
            ignoreDefaultEvents: false,
        };
        const worldMeta = {
            serverId,
            season: 4,
            scenarioId: 22,
            gameIdx: 7,
            isUnited: 0,
            killturn: 24,
            scenarioMeta,
        };
        await db.worldState.create({
            data: {
                id: worldId,
                scenarioCode: 'explicit-retirement-integration',
                currentYear: 200,
                currentMonth: 1,
                tickSeconds: 600,
                config: scenarioConfig as GamePrisma.InputJsonValue,
                meta: worldMeta as GamePrisma.InputJsonValue,
            },
        });
        await db.nation.create({
            data: { id: nationId, name: '은퇴국', color: '#330000', level: 1, capitalCityId: cityId },
        });
        await db.city.create({
            data: {
                id: cityId,
                name: '은퇴성',
                level: 5,
                nationId,
                population: 10_000,
                populationMax: 20_000,
                agriculture: 1_000,
                agricultureMax: 2_000,
                commerce: 1_000,
                commerceMax: 2_000,
                security: 1_000,
                securityMax: 2_000,
                defence: 1_000,
                defenceMax: 2_000,
                wall: 1_000,
                wallMax: 2_000,
                region: 1,
            },
        });
        await db.general.create({
            data: {
                id: general.id,
                userId: general.userId,
                name: general.name,
                nationId,
                cityId,
                npcState: 0,
                leadership: general.stats.leadership,
                strength: general.stats.strength,
                intel: general.stats.intelligence,
                experience: general.experience,
                dedication: general.dedication,
                officerLevel: general.officerLevel,
                injury: general.injury,
                gold: general.gold,
                rice: general.rice,
                crew: general.crew,
                crewTypeId: general.crewTypeId,
                train: general.train,
                atmos: general.atmos,
                turnTime: general.turnTime,
                age: general.age,
                bornYear: general.bornYear,
                deadYear: general.deadYear,
                meta: general.meta as GamePrisma.InputJsonValue,
            },
        });
        await db.general.create({
            data: {
                id: automaticGeneral.id,
                userId: automaticGeneral.userId,
                name: automaticGeneral.name,
                nationId,
                cityId,
                npcState: 0,
                leadership: automaticGeneral.stats.leadership,
                strength: automaticGeneral.stats.strength,
                intel: automaticGeneral.stats.intelligence,
                experience: automaticGeneral.experience,
                dedication: automaticGeneral.dedication,
                officerLevel: automaticGeneral.officerLevel,
                injury: automaticGeneral.injury,
                gold: automaticGeneral.gold,
                rice: automaticGeneral.rice,
                crew: automaticGeneral.crew,
                crewTypeId: automaticGeneral.crewTypeId,
                train: automaticGeneral.train,
                atmos: automaticGeneral.atmos,
                turnTime: automaticGeneral.turnTime,
                age: automaticGeneral.age,
                bornYear: automaticGeneral.bornYear,
                deadYear: automaticGeneral.deadYear,
                meta: automaticGeneral.meta as GamePrisma.InputJsonValue,
            },
        });
        await db.rankData.createMany({
            data: [
                ...RANK_DATA_TYPES.map((type) => ({
                    generalId: general.id,
                    nationId,
                    type,
                    value: type === 'warnum' ? 10 : type === 'firenum' ? 8 : type === 'inherit_earned' ? 123 : 0,
                })),
                ...RANK_DATA_TYPES.map((type) => ({
                    generalId: automaticGeneral.id,
                    nationId,
                    type,
                    value: type === 'warnum' ? 5 : type === 'inherit_spent_dyn' ? 3_000 : 0,
                })),
            ],
        });
        await db.inheritancePoint.createMany({
            data: [
                { userId: general.userId!, key: 'previous', value: 50 },
                { userId: general.userId!, key: 'lived_month', value: 10 },
                { userId: general.userId!, key: 'active_action', value: 4 },
                { userId: automaticGeneral.userId!, key: 'previous', value: 70 },
                { userId: automaticGeneral.userId!, key: 'lived_month', value: 10 },
                { userId: automaticGeneral.userId!, key: 'active_action', value: 4 },
            ],
        });
        await db.gameHistory.createMany({
            data: [
                {
                    serverId,
                    date: new Date('2026-08-24T00:00:00.000Z'),
                    season: 4,
                    scenario: 22,
                    scenarioName: scenarioMeta.title,
                    status: 'OPEN',
                },
                {
                    serverId: `${serverId}-completed`,
                    date: new Date('2026-08-23T00:00:00.000Z'),
                    season: 3,
                    scenario: 22,
                    scenarioName: '완료',
                    status: 'COMPLETED',
                },
                {
                    serverId: `${serverId}-abandoned`,
                    date: new Date('2026-08-22T00:00:00.000Z'),
                    season: 3,
                    scenario: 22,
                    scenarioName: '취소',
                    status: 'ABANDONED',
                },
            ],
        });

        const reservedTurns = new InMemoryReservedTurnStore(db, { maxGeneralTurns: 3, maxNationTurns: 3 });
        await reservedTurns.loadAll();
        reservedTurns.setGeneralTurn(general.id, 0, { action: 'che_은퇴', args: {} });
        reservedTurns.setGeneralTurn(general.id, 1, { action: 'che_은퇴', args: {} });
        reservedTurns.setGeneralTurn(automaticGeneral.id, 0, { action: 'che_훈련', args: {} });
        const state: TurnWorldState = {
            id: worldId,
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
            meta: worldMeta,
        };
        const nation = {
            id: nationId,
            name: '은퇴국',
            color: '#330000',
            capitalCityId: cityId,
            chiefGeneralId: general.id,
            gold: 10_000,
            rice: 10_000,
            power: 0,
            level: 1,
            typeCode: 'che_중립',
            meta: { gennum: 2, tech: 0 },
        };
        const city = {
            id: cityId,
            name: '은퇴성',
            nationId,
            level: 5,
            state: 0,
            population: 10_000,
            populationMax: 20_000,
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
            meta: { trust: 50, trade: 100, region: 1 },
        };
        const map = {
            id: 'explicit-retirement',
            name: '명시적 은퇴',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        };
        let world: InMemoryTurnWorld | null = null;
        const handler = await createReservedTurnHandler({
            reservedTurns,
            scenarioConfig,
            scenarioMeta,
            map,
            getWorld: () => world,
        });
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig,
            scenarioMeta,
            map,
            generals: [general, automaticGeneral],
            nations: [nation],
            cities: [city],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            generalTurnHandler: handler,
        });
        world.executeGeneralTurn(world.getGeneralById(automaticGeneral.id)!);
        world.executeGeneralTurn(world.getGeneralById(general.id)!);
        world.executeGeneralTurn(world.getGeneralById(general.id)!);
        expect(world.peekDirtyState().lifecycleEvents.some((entry) => entry.outcome === 'retired')).toBe(true);
        expect(world.peekDirtyState().inheritancePointAdjustments).toContainEqual({
            userId: general.userId,
            key: 'previous',
            amount: 3_000,
            phase: 'after_lifecycle',
        });
        expect(world.peekDirtyState().inheritancePointAdjustments).toContainEqual({
            userId: automaticGeneral.userId,
            key: 'previous',
            amount: 3_000,
        });

        const hooks = await createDatabaseTurnHooks(databaseUrl!, world, { reservedTurns });
        try {
            await hooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 2,
                processedTurns: 3,
                durationMs: 0,
                partial: false,
            });
        } finally {
            await hooks.close();
        }

        const reloaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        expect(reloaded.snapshot.generals.find((entry) => entry.id === general.id)).toMatchObject({
            age: 20,
            experience: 501,
            dedication: 401,
            meta: {
                rank_warnum: 0,
                firenum: 0,
                inherit_earned: 0,
                inherit_lived_month: 0,
                inherit_active_action: 0,
                inherit_spent_dyn: -3_000,
                dex1: 100,
            },
        });
        expect(reloaded.snapshot.generals.find((entry) => entry.id === general.id)?.meta).not.toHaveProperty(
            'inheritRandomUnique'
        );
        expect(reloaded.snapshot.generals.find((entry) => entry.id === automaticGeneral.id)).toMatchObject({
            age: 20,
            meta: {
                rank_warnum: 0,
                inherit_lived_month: 0,
                inherit_active_action: 0,
                inherit_spent_dyn: 0,
            },
        });
        expect(reloaded.snapshot.generals.find((entry) => entry.id === automaticGeneral.id)?.meta).not.toHaveProperty(
            'inheritRandomUnique'
        );
        await expect(
            db.hallOfFame.findUniqueOrThrow({
                where: { serverId_type_generalNo: { serverId, type: 'warnum', generalNo: general.id } },
            })
        ).resolves.toMatchObject({ value: 11, aux: expect.objectContaining({ serverIdx: 7 }) });
        await expect(
            db.hallOfFame.findUniqueOrThrow({
                where: { serverId_type_generalNo: { serverId, type: 'firenum', generalNo: general.id } },
            })
        ).resolves.toMatchObject({ value: 9 });
        await expect(
            db.hallOfFame.findUniqueOrThrow({
                where: { serverId_type_generalNo: { serverId, type: 'inherit_earned', generalNo: general.id } },
            })
        ).resolves.toMatchObject({ value: 4_321 });
        await expect(
            db.hallOfFame.findUniqueOrThrow({
                where: { serverId_type_generalNo: { serverId, type: 'dex1', generalNo: general.id } },
            })
        ).resolves.toMatchObject({ value: 120 });
        const result = await db.inheritanceResult.findFirstOrThrow({
            where: { serverId, owner: general.userId! },
            orderBy: { id: 'desc' },
        });
        expect(result.value).toMatchObject({ combat: 55, sabotage: 180, dex: 0.06, rebirth: true });
        const inheritanceLogs = await db.inheritanceLog.findMany({
            where: { userId: general.userId! },
            orderBy: { id: 'asc' },
            select: { text: true },
        });
        const settlementLogIndex = inheritanceLogs.findIndex(({ text }) => text.startsWith('포인트 '));
        const refundLogIndex = inheritanceLogs.findIndex(
            ({ text }) => text === '유니크를 얻을 공간이 없어 3000 포인트 반환'
        );
        expect(settlementLogIndex).toBeGreaterThanOrEqual(0);
        expect(refundLogIndex).toBeGreaterThan(settlementLogIndex);
        const persistedPrevious = await db.inheritancePoint.findUniqueOrThrow({
            where: { userId_key: { userId: general.userId!, key: 'previous' } },
        });
        expect(persistedPrevious.value).toBeGreaterThan(3_000);
        const automaticInheritanceLogs = await db.inheritanceLog.findMany({
            where: { userId: automaticGeneral.userId! },
            orderBy: { id: 'asc' },
            select: { text: true },
        });
        const automaticRefundLogIndex = automaticInheritanceLogs.findIndex(
            ({ text }) => text === '유니크를 얻을 공간이 없어 3000 포인트 반환'
        );
        const automaticSettlementLogIndex = automaticInheritanceLogs.findIndex(({ text }) =>
            text.startsWith('포인트 ')
        );
        expect(automaticRefundLogIndex).toBeGreaterThanOrEqual(0);
        expect(automaticSettlementLogIndex).toBeGreaterThan(automaticRefundLogIndex);
        await expect(db.oldGeneral.count({ where: { serverId, generalNo: general.id } })).resolves.toBe(0);
        await expect(db.oldGeneral.count({ where: { serverId, generalNo: automaticGeneral.id } })).resolves.toBe(0);
    });
});
