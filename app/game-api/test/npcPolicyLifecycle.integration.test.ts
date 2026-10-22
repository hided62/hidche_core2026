import { afterAll, beforeAll, expect, it } from 'vitest';
import fastify from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { asRecord } from '@sammo-ts/common';
import { createGamePostgresConnector, createRedisConnector, GamePrisma } from '@sammo-ts/infra';
import { createTurnDaemonRuntime, seedScenarioToDatabase, type TurnDaemonRuntime } from '@sammo-ts/game-engine';
import { appRouter } from '../src/router.js';
import { DatabaseTurnDaemonTransport } from '../src/daemon/databaseTransport.js';
import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { GameApiContext } from '../src/context.js';

const databaseUrl = process.env.NPC_POLICY_DATABASE_URL;
const integration = it.skipIf(!databaseUrl || !process.env.REDIS_URL);
const connector = databaseUrl ? createGamePostgresConnector({ url: databaseUrl }) : null;
const redis = process.env.REDIS_URL ? createRedisConnector({ url: process.env.REDIS_URL }) : null;
let runtime: TurnDaemonRuntime | undefined;
let loop: Promise<void> | undefined;
const profile = `npc-policy:${databaseUrl ? new URL(databaseUrl).searchParams.get('schema') : 'fixture'}`;
const baseTime = new Date('0185-01-01T00:00:00Z');

beforeAll(async () => {
    if (!databaseUrl) return;
    if (!new URL(databaseUrl).searchParams.get('schema')?.endsWith('_npc_policy_fixture'))
        throw new Error('Dedicated NPC policy fixture schema required');
    await connector!.connect();
    await redis!.connect();
});
afterAll(async () => {
    if (loop) {
        await runtime?.lifecycle.stop();
        await loop;
    }
    await runtime?.close();
    await connector?.disconnect();
    await redis?.disconnect();
});

integration(
    'HTTP user edits survive daemon restart and real NPC turns, with readable actor and before/after history',
    async () => {
        const db = connector!.prisma;
        await db.playAuditPolicy.deleteMany({
            where: {
                OR: [
                    { serverId: 'npc-policy-lifecycle' },
                    { id: { in: ['c'.repeat(64), 'd'.repeat(64), 'e'.repeat(64)] } },
                ],
            },
        });
        await db.playAuditMonth.deleteMany({ where: { serverId: 'npc-policy-lifecycle' } });
        await db.playAuditDecisionChunk.deleteMany({ where: { decision: { serverId: 'npc-policy-lifecycle' } } });
        await db.playAuditDecision.deleteMany({ where: { serverId: 'npc-policy-lifecycle' } });
        await db.playAuditDiplomacyEvent.deleteMany({ where: { serverId: 'npc-policy-lifecycle' } });
        await db.inputEvent.deleteMany({ where: { requestId: { startsWith: 'npc-policy-http-' } } });
        await seedScenarioToDatabase({
            scenarioId: 903,
            databaseUrl: databaseUrl!,
            now: new Date(),
            installOptions: {
                openAt: new Date(Date.now() + 86_400_000),
                turnTermMinutes: 5,
                npcMode: 2,
                showImgLevel: 3,
                serverId: 'npc-policy-lifecycle',
                season: 1,
            },
        });
        await db.generalTurn.deleteMany();
        await db.nationTurn.deleteMany();
        await db.general.deleteMany();
        await db.nation.deleteMany();
        await db.diplomacy.deleteMany();
        // 185년 고정 fixture에 180년 시나리오의 지연 등장 이벤트를 이월하지 않는다.
        // 일반턴·월간 재정/도시 갱신은 실제 runtime handler를 그대로 실행한다.
        await db.event.deleteMany();
        const city = await db.city.findFirstOrThrow({ orderBy: { id: 'asc' } });
        const world = await db.worldState.findFirstOrThrow();
        await db.worldState.update({
            where: { id: world.id },
            data: {
                currentYear: 185,
                currentMonth: 1,
                clockBaseTime: baseTime,
                clockTick: 0n,
                lastTurnTick: 0n,
                clockPhase: 'RUNNING',
                clockMode: 'realtime',
                clockWallAnchor: new Date(),
                config: { ...asRecord(world.config), tournamentTrig: false },
            },
        });
        await db.nation.create({
            data: {
                id: 1,
                name: '정책국',
                color: '#ffffff',
                level: 3,
                chiefGeneralId: 1,
                capitalCityId: city.id,
                gold: 100_000,
                rice: 100_000,
                tech: 3000,
                meta: {},
            },
        });
        await db.city.updateMany({ data: { nationId: 0 } });
        await db.city.update({
            where: { id: city.id },
            data: {
                nationId: 1,
                population: 100_000,
                populationMax: 200_000,
                supplyState: 1,
                frontState: 1,
                meta: { trust: 80, trade: 100 },
            },
        });
        await db.general.createMany({
            data: [
                {
                    id: 1,
                    userId: 'npc-policy-owner',
                    name: '정책군주',
                    nationId: 1,
                    cityId: city.id,
                    officerLevel: 12,
                    npcState: 0,
                    turnTime: new Date('0185-02-01Z'),
                    turnTick: 100_000_000n,
                    meta: { belong: 5, killturn: 24 },
                },
                {
                    id: 2,
                    name: '징병검증장',
                    nationId: 1,
                    cityId: city.id,
                    officerLevel: 1,
                    npcState: 2,
                    leadership: 80,
                    strength: 80,
                    intel: 30,
                    gold: 100_000,
                    rice: 100_000,
                    crew: 0,
                    turnTime: baseTime,
                    turnTick: 0n,
                    meta: { killturn: 24, armType: 1, dex1: 1000 },
                },
            ],
        });
        const transport = new DatabaseTurnDaemonTransport(db, 10_000);
        const auth: NonNullable<GameApiContext['auth']> = {
            version: 1,
            profile,
            sessionId: 'fixture-session',
            issuedAt: new Date().toISOString(),
            expiresAt: '2999-01-01T00:00:00Z',
            user: { id: 'npc-policy-owner', username: 'fixture', displayName: 'fixture', roles: [] },
            sanctions: {},
        };
        const app = fastify();
        let request = 0;
        await app.register(fastifyTRPCPlugin, {
            prefix: '/che/api/trpc',
            trpcOptions: {
                router: appRouter,
                createContext: ({
                    req,
                }: {
                    req: { headers: Record<string, string | string[] | undefined> };
                }): GameApiContext => ({
                    db,
                    redis: redis!.client,
                    profile: { id: 'hwe', scenario: '903', name: profile },
                    auth: req.headers['x-session-token'] === 'fixture-session' ? auth : null,
                    requestId: `npc-policy-http-${++request}`,
                    turnDaemon: transport,
                    accessTokenStore: new RedisAccessTokenStore(redis!.client, profile),
                    flushStore: new InMemoryFlushStore(),
                    battleSim: {} as GameApiContext['battleSim'],
                    uploadDir: '/tmp',
                    uploadPath: '/uploads',
                    uploadPublicUrl: null,
                    gameTokenSecret: 'fixture-only',
                }),
            },
        });
        const actions: Array<{ kind: string; actionKey: string; generalId: number; completed?: boolean }> = [];
        const start = async () => {
            const instance = await createTurnDaemonRuntime({
                profile,
                databaseUrl: databaseUrl!,
                enableLeaseHeartbeat: false,
                onActionResolved: (action) => actions.push(action),
            });
            // 자연 진행은 정지하고, 사용자 command와 명시한 due 턴만 처리한다.
            instance.lifecycle.pause('NPC policy fixture');
            return instance;
        };
        const call = async (endpoint: string, input: unknown, mutation = false) => {
            const response = await app.inject({
                method: mutation ? 'POST' : 'GET',
                url: `/che/api/trpc/npc.${endpoint}${mutation ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
                headers: {
                    'x-session-token': 'fixture-session',
                    ...(mutation ? { 'content-type': 'application/json' } : {}),
                },
                ...(mutation ? { payload: JSON.stringify(input) } : {}),
            });
            expect(response.statusCode, response.body).toBe(200);
            return response.json<{ result: { data: unknown } }>().result.data;
        };
        const configuration = (value: unknown) => {
            const data = asRecord(value);
            return {
                values: data.currentNationPolicy,
                nation: data.currentNationPriority,
                general: data.currentGeneralActionPriority,
                setters: data.lastSetters,
            };
        };
        try {
            runtime = await start();
            loop = runtime.lifecycle.start();
            // 발령과 징병을 목록에서 빼면 실제 턴에서도 수행하지 않아야 한다.
            await call('setNationPriority', ['NPC포상'], true);
            await call('setGeneralPriority', ['출병', '일반내정'], true);
            await call(
                'setNationPolicy',
                { minWarCrew: 2000, minNPCRecruitCityPopulation: 30000, safeRecruitCityPopulationRatio: 0 },
                true
            );
            const withoutRecruitment = await call('getPolicy', {});
            expect(withoutRecruitment).toMatchObject({
                currentNationPriority: ['NPC포상'],
                currentGeneralActionPriority: ['출병', '일반내정'],
            });
            await runtime.lifecycle.stop();
            await loop;
            loop = undefined;
            await runtime.close();
            runtime = await start();
            expect(configuration(await call('getPolicy', {}))).toEqual(configuration(withoutRecruitment));
            let result = await runtime.processor.run(baseTime, { budgetMs: 10_000, maxGenerals: 1, catchUpCap: 1 });
            expect(result.processedGenerals).toBe(1);
            expect(runtime.world.getGeneralById(2)!.crew).toBe(0);
            expect(
                actions.filter((action) => action.generalId === 2).some((action) => action.actionKey === 'che_징병')
            ).toBe(false);
            await runtime.hooks!.flushChanges!(result);
            expect(configuration(await call('getPolicy', {}))).toEqual(configuration(withoutRecruitment));
            // 같은 장수·자원으로 징병 우선순위를 맨 앞에 저장한 뒤 다시 시작한다.
            loop = runtime.lifecycle.start();
            await call('setGeneralPriority', ['징병', '출병', '일반내정'], true);
            const saved = await call('getPolicy', {});
            await runtime.lifecycle.stop();
            await loop;
            loop = undefined;
            await runtime.close();
            runtime = await start();
            expect(configuration(await call('getPolicy', {}))).toEqual(configuration(saved));
            const beforeMeta = asRecord(runtime.world.getNationById(1)!.meta);
            // 실제 due 턴과 command를 실행한다. 전방의 중립 도시가 전쟁 상태를 만든다.
            actions.length = 0;
            result = await runtime.processor.run(runtime.world.getGeneralById(2)!.turnTime, {
                budgetMs: 10_000,
                maxGenerals: 1,
                catchUpCap: 1,
            });
            expect(result.processedGenerals).toBe(1);
            expect(runtime.world.getGeneralById(2)!.crew).toBeGreaterThan(0);
            expect(actions).toContainEqual(
                expect.objectContaining({ generalId: 2, actionKey: 'che_징병', completed: true })
            );
            await runtime.hooks!.flushChanges!(result);
            expect((await db.general.findUniqueOrThrow({ where: { id: 2 } })).crew).toBeGreaterThan(0);
            expect(asRecord(runtime.world.getNationById(1)!.meta).npc_nation_policy).toEqual(
                beforeMeta.npc_nation_policy
            );
            expect(configuration(await call('getPolicy', {}))).toEqual(configuration(saved));
            // 병력이 소진되고 도시 인구가 정책 하한 미만이면 징병을 거른다.
            runtime.world.updateGeneral(2, { crew: 0 });
            runtime.world.updateCity(city.id, { population: 30_100 });
            actions.length = 0;
            result = await runtime.processor.run(runtime.world.getGeneralById(2)!.turnTime, {
                budgetMs: 10_000,
                maxGenerals: 1,
                catchUpCap: 1,
            });
            expect(result.processedGenerals).toBe(1);
            expect(runtime.world.getGeneralById(2)!.crew).toBe(0);
            expect(actions.some((action) => action.actionKey === 'che_징병')).toBe(false);
            await runtime.hooks!.flushChanges!(result);
            expect(configuration(await call('getPolicy', {}))).toEqual(configuration(saved));
            // 이후의 개인턴/월간 갱신도 정책을 덮어쓰면 안 된다.
            const target = new Date(runtime.world.getGeneralById(2)!.turnTime.getTime() + 30 * 60_000);
            result = await runtime.processor.run(target, { budgetMs: 10_000, maxGenerals: 100, catchUpCap: 12 });
            expect(result.processedGenerals).toBeGreaterThan(1);
            await runtime.hooks!.flushChanges!(result);
            expect(await call('getPolicy', {})).toMatchObject({
                currentNationPriority: ['NPC포상'],
                currentGeneralActionPriority: ['징병', '출병', '일반내정'],
                currentNationPolicy: { minWarCrew: 2000, minNPCRecruitCityPopulation: 30000 },
            });
            expect(runtime.world.getState().meta.playAuditGap).toBeUndefined();
            const history = await call('policyHistory', { area: 'NPC_NATION_PRIORITY' });
            expect(history).toMatchObject({
                items: [
                    expect.objectContaining({ source: 'CHANGE', actor: expect.objectContaining({ name: '정책군주' }) }),
                    expect.anything(),
                ],
            });
            const row = await db.playAuditPolicy.findFirstOrThrow({
                where: { nationId: 1, area: 'NPC_NATION_PRIORITY', source: 'CHANGE' },
            });
            expect(await call('policyVersion', { id: row.id })).toMatchObject({
                actor: { name: '정책군주' },
                fields: [{ key: 'priority', beforeJson: 'null', afterJson: '["NPC포상"]', changed: true }],
            });
            expect(row.inputSequence).not.toBeNull();
            expect((await db.inputEvent.findUniqueOrThrow({ where: { sequence: row.inputSequence! } })).status).toBe(
                'SUCCEEDED'
            );
            // 외국/이전 기수/국방 정책 ID를 알아도 자국 NPC 정책으로 조회할 수 없다.
            for (const [id, patch] of [
                ['c'.repeat(64), { nationId: 2 }],
                ['d'.repeat(64), { serverId: 'previous-season' }],
                ['e'.repeat(64), { area: 'DEFENCE' }],
            ] as const) {
                await db.playAuditPolicy.create({
                    data: {
                        ...row,
                        id,
                        ...patch,
                        actor: row.actor ?? GamePrisma.DbNull,
                        before: row.before ?? GamePrisma.DbNull,
                        after: row.after ?? GamePrisma.JsonNull,
                    },
                });
                const response = await app.inject({
                    url: `/che/api/trpc/npc.policyVersion?input=${encodeURIComponent(JSON.stringify({ id }))}`,
                    headers: { 'x-session-token': 'fixture-session' },
                });
                expect(response.statusCode).toBe(404);
            }
            await db.general.update({ where: { id: 1 }, data: { penalty: { noChief: true } } });
            const denied = await app.inject({
                url: `/che/api/trpc/npc.policyHistory?input=${encodeURIComponent(JSON.stringify({ area: 'NPC_VALUES' }))}`,
                headers: { 'x-session-token': 'fixture-session' },
            });
            expect(denied.statusCode).toBe(403);
        } finally {
            await app.close();
        }
    },
    90_000
);
