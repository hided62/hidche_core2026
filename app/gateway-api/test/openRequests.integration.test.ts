import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fastify, { type FastifyRequest } from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { trpcJsonBodyHttpServerOptions } from '@sammo-ts/common';
import { createGatewayPostgresConnector } from '@sammo-ts/infra';
import { createPostgresUserRepository } from '../src/auth/postgresUserRepository.js';
import { InMemoryGatewaySessionService } from '../src/auth/inMemorySessionService.js';
import { createPasswordEnvelopeService } from '../src/auth/passwordEnvelope.js';
import { createGatewayApiContext } from '../src/context.js';
import { createGatewayProfileRepository } from '../src/orchestrator/profileRepository.js';
import { InMemoryProfileStatusService } from '../src/lobby/profileStatusService.js';
import { appRouter } from '../src/router.js';
import { createOpenRequest, actOnOpenRequest, listOpenRequests } from '../src/openRequests/service.js';
import { readOpenRequestPolicy } from '../src/openRequests/policy.js';
import * as catalog from '../src/scenario/scenarioCatalog.js';

vi.mock('../src/scenario/scenarioCatalog.js', () => ({
    listScenarioPreviews: vi.fn(async () => [
        {
            id: 2,
            title: '기본 시나리오',
            defaultStatTotal: 165,
            year: 184,
            fiction: 1,
            npcCount: 100,
            npcExCount: 0,
            npcNeutralCount: 0,
            nations: [],
        },
    ]),
    resolveGitCommitSha: vi.fn(async () => 'a'.repeat(40)),
    resolveGitBranchCommitSha: vi.fn(async () => 'b'.repeat(40)),
    supportsProfileReleaseBuild: vi.fn(async () => true),
}));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const databaseUrl = process.env.OPEN_REQUEST_DATABASE_URL;
const suite = describe.runIf(Boolean(databaseUrl));
const profileName = 'opening:default';
const install = () => ({
    scenarioId: 2,
    turnTermMinutes: 3,
    sync: true,
    fiction: 1,
    extend: true,
    blockGeneralCreate: 0,
    npcMode: 0,
    showImgLevel: 3,
    tournamentTrig: true,
    joinMode: 'full' as const,
    autorunUser: null,
    preopenAt: new Date(Date.now() + 86_400_000).toISOString(),
    openAt: new Date(Date.now() + 90_000_000).toISOString(),
});

suite('durable opening requests (isolated PostgreSQL and HTTP)', () => {
    const connector = createGatewayPostgresConnector({ url: databaseUrl ?? '' });
    const prisma = connector.prisma;
    const users = createPostgresUserRepository(prisma);
    const profiles = createGatewayProfileRepository(prisma);
    const sessions = new InMemoryGatewaySessionService({ sessionTtlSeconds: 3600, gameSessionTtlSeconds: 600 });
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const passwordEnvelope = createPasswordEnvelopeService();
    const profileStatus = new InMemoryProfileStatusService([
        {
            profileName,
            profile: 'opening',
            instanceKey: 'default',
            currentScenario: null,
            scenario: 'default',
            status: 'STOPPED',
            apiPort: 15991,
            korName: '테스트',
            color: '#fff',
            runtime: {
                apiRunning: false,
                daemonRunning: false,
                auctionRunning: false,
                battleSimRunning: false,
                tournamentRunning: false,
            },
            lifecycle: {
                runtimeExpected: false,
                userAccessible: false,
                turnsRunning: false,
                operatorResumable: true,
                dataInitialized: false,
            },
        },
    ]);
    const context = (headers: Record<string, string | string[] | undefined> = {}) =>
        createGatewayApiContext({
            prisma,
            users,
            profiles,
            sessions,
            passwordEnvelope,
            profileStatus,
            requestHeaders: headers,
            flushPublisher: { publishUserFlush: async () => {} },
            gameTokenSecret: 'fixture-only',
            gameSessionTtlSeconds: 600,
            publicBaseUrl: 'http://127.0.0.1',
            localAccountGraceDays: 7,
            adminLocalAccountEnabled: false,
            localRegistrationEnabled: false,
            kakaoClient: {} as never,
            oauthSessions: {} as never,
            orchestrator: {} as never,
        });
    const user = async (index: number) => (await users.findById(ids[index]!))!;
    const caller = async (index: number) => {
        const session = await sessions.createSession(await user(index));
        return appRouter.createCaller(context({ 'x-session-token': session.sessionToken }));
    };
    const app = fastify();
    beforeAll(async () => {
        // This database is created exclusively for this suite by the verification runner.
        if (
            !databaseUrl?.includes('open_request') &&
            new URL(databaseUrl!).searchParams.get('schema') !== process.env.GATEWAY_RUNTIME_INTEGRATION_SCHEMA
        )
            throw new Error('Use an isolated open_request database/schema.');
        await connector.connect();
        await app.register(fastifyTRPCPlugin, {
            prefix: '/gateway/api/trpc',
            trpcOptions: {
                router: appRouter,
                ...trpcJsonBodyHttpServerOptions,
                createContext: ({ req }: { req: FastifyRequest }) => context(req.headers),
            },
        });
        if (process.env.OPEN_REQUEST_BROWSER === '1') {
            await app.register(fastifyStatic, {
                root: path.join(repositoryRoot, 'app/gateway-frontend/dist'),
                prefix: '/gateway/',
            });
            app.get('/gateway/api/navigation', async () =>
                JSON.parse(await fs.readFile(path.join(repositoryRoot, 'resources/navigation.json'), 'utf8'))
            );
            app.setNotFoundHandler((request, reply) =>
                request.url.startsWith('/gateway/') && !request.url.includes('/api/')
                    ? reply.sendFile('index.html')
                    : reply.code(404).send()
            );
        }
        await app.ready();
    });
    beforeEach(async () => {
        await prisma.gatewayOpenRequest.deleteMany({ where: { profileName } });
        await prisma.gatewayOperation.deleteMany({ where: { profileName } });
        await prisma.specialAccountAccessGrant.deleteMany({ where: { userId: { in: ids } } });
        await prisma.appUser.deleteMany({ where: { id: { in: ids } } });
        for (let index = 0; index < ids.length; index++) {
            await prisma.appUser.create({
                data: {
                    id: ids[index],
                    loginId: `opening-${ids[0]}-${index}`,
                    displayName: `사용자${index}-${ids[0]!.slice(0, 6)}`,
                    passwordHash: 'fixture',
                    passwordSalt: 'fixture',
                    oauthType: index === 4 ? 'NONE' : 'KAKAO',
                    oauthId: index === 4 ? null : `opening-${ids[0]}-${index}`,
                    kakaoVerifiedAt: index === 4 ? null : new Date(),
                    createdAt: new Date(2020 + index, 0, 1),
                    roles: index === 3 ? [`admin.scenarios.reset:${profileName}`] : [],
                },
            });
        }
        await profiles.upsertProfile({
            profile: 'opening',
            instanceKey: 'default',
            apiPort: 15991,
            status: 'STOPPED',
            buildCommitSha: 'a'.repeat(40),
            meta: {},
        });
        await prisma.gatewayProfile.update({
            where: { profileName },
            data: { openAt: null, preopenAt: null, currentScenario: null, meta: {} },
        });
        vi.clearAllMocks();
        vi.mocked(catalog.supportsProfileReleaseBuild).mockResolvedValue(true);
    });
    afterAll(async () => {
        await app.close();
        await connector.disconnect();
    });
    const create = async (index = 1) => createOpenRequest(context(), await user(index), profileName, install());
    const policy = async (threshold: number | null, extra: Record<string, number> = {}) =>
        prisma.gatewayProfile.update({
            where: { profileName },
            data: { meta: { openRequestPolicy: { endorsementThreshold: threshold, ...extra } } },
        });

    it('persists immutable settings and expires before build; repeated submission is idempotent', async () => {
        const input = install();
        const first = await createOpenRequest(context(), await user(1), profileName, input);
        const replay = await createOpenRequest(context(), await user(1), profileName, input);
        expect(replay.id).toBe(first.id);
        const row = await prisma.gatewayOpenRequest.findUniqueOrThrow({ where: { id: first.id } });
        expect(row.install).toEqual(input);
        expect(row.expiresAt.getTime()).toBe(new Date(input.preopenAt).getTime() - 600_000);
        expect(await prisma.gatewayOperation.count({ where: { profileName } })).toBe(0);
        expect((await listOpenRequests(context(), await user(2), profileName)).requests).toHaveLength(1);
        expect(JSON.stringify(await listOpenRequests(context(), await user(2), profileName))).not.toContain('password');
    });
    it('uses the configured lifetime for distant proposals', async () => {
        await policy(null, { lifetimeDays: 2 });
        const input = install();
        input.preopenAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
        input.openAt = new Date(Date.now() + 11 * 86_400_000).toISOString();
        const r = await createOpenRequest(context(), await user(1), profileName, input);
        const row = await prisma.gatewayOpenRequest.findUniqueOrThrow({ where: { id: r.id } });
        expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeCloseTo(2 * 86_400_000, -3);
    });
    it.each(['RUNNING', 'PREOPEN', 'PAUSED', 'RESERVED', 'DISABLED'] as const)(
        'rejects requests in %s',
        async (status) => {
            await prisma.gatewayProfile.update({ where: { profileName }, data: { status } });
            await expect(create()).rejects.toMatchObject({ code: 'CONFLICT' });
            expect(await prisma.gatewayOpenRequest.count({ where: { profileName } })).toBe(0);
        }
    );
    it.each(['COMPLETED', 'STOPPED', 'CANCELLED'] as const)('accepts a request in %s', async (status) => {
        await prisma.gatewayProfile.update({ where: { profileName }, data: { status } });
        await expect(create()).resolves.toMatchObject({ status: 'PENDING' });
    });
    it('rejects grace-only and sanctioned accounts, accepts a scoped active special grant', async () => {
        await expect(create(4)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await prisma.specialAccountAccessGrant.create({
            data: {
                userId: ids[4]!,
                kind: 'TESTER',
                profiles: ['different'],
                allowsGeneralCreation: true,
                reason: 'fixture',
                grantedByUserId: ids[0]!,
            },
        });
        await expect(create(4)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await prisma.specialAccountAccessGrant.updateMany({
            where: { userId: ids[4] },
            data: { profiles: [profileName] },
        });
        await expect(create(4)).resolves.toMatchObject({ status: 'PENDING' });
        await prisma.appUser.update({
            where: { id: ids[1] },
            data: { sanctions: { serverRestrictions: { [profileName]: { blockedFeatures: ['game'] } } } },
        });
        await expect(create()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
    it('deduplicates concurrent endorsements and excludes self agreement', async () => {
        await policy(3);
        const r = await create();
        await expect(actOnOpenRequest(context(), await user(1), r.id, 'ENDORSE')).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
        await Promise.all(
            Array.from({ length: 5 }, async () => actOnOpenRequest(context(), await user(2), r.id, 'ENDORSE'))
        );
        expect(await prisma.gatewayOpenEndorsement.count({ where: { requestId: r.id } })).toBe(1);
        expect(await prisma.gatewayOperation.count({ where: { profileName } })).toBe(0);
    });
    it('atomically reserves once at consensus, follows branch policy, supersedes other proposals', async () => {
        await policy(2, { buildLeadMinutes: 25 });
        await prisma.gatewayProfile.update({
            where: { profileName },
            data: {
                meta: {
                    releaseSource: { mode: 'BRANCH', ref: 'main' },
                    openRequestPolicy: { endorsementThreshold: 2, buildLeadMinutes: 25 },
                },
            },
        });
        const r = await create();
        const other = await create(2);
        await Promise.all([
            actOnOpenRequest(context(), await user(2), r.id, 'ENDORSE'),
            actOnOpenRequest(context(), await user(3), r.id, 'ENDORSE'),
        ]);
        const row = await prisma.gatewayOpenRequest.findUniqueOrThrow({ where: { id: r.id } });
        const ops = await prisma.gatewayOperation.findMany({ where: { profileName } });
        expect(row.status).toBe('RESERVED');
        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({
            sourceMode: 'BRANCH',
            sourceRef: 'main',
            resolvedCommitSha: null,
            status: 'QUEUED',
        });
        expect(ops[0]!.scheduledAt!.getTime()).toBe(row.preopenAt.getTime() - 25 * 60_000);
        expect((await prisma.gatewayOpenRequest.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
            'SUPERSEDED'
        );
        expect(await profiles.claimNextOperation(new Date())).toBeNull();
    });
    it('keeps CHE-style manual approval and validates scoped opener capability', async () => {
        expect(readOpenRequestPolicy({}).endorsementThreshold).toBeNull();
        const r = await create();
        await expect((await caller(2)).admin.openRequests.decide({ id: r.id, action: 'ACCEPT' })).rejects.toMatchObject(
            { code: 'FORBIDDEN' }
        );
        await expect(actOnOpenRequest(context(), await user(2), r.id, 'ENDORSE')).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
        await Promise.all([
            (await caller(3)).admin.openRequests.decide({ id: r.id, action: 'ACCEPT' }),
            (await caller(3)).admin.openRequests.decide({ id: r.id, action: 'ACCEPT' }),
        ]);
        expect(await prisma.gatewayOperation.count({ where: { profileName } })).toBe(1);
    });
    it('does not count a voter whose membership has been revoked', async () => {
        await policy(2);
        const r = await create();
        await actOnOpenRequest(context(), await user(2), r.id, 'ENDORSE');
        await prisma.appUser.update({ where: { id: ids[2] }, data: { kakaoVerifiedAt: null } });
        await actOnOpenRequest(context(), await user(3), r.id, 'ENDORSE');
        expect(await prisma.gatewayOperation.count({ where: { profileName } })).toBe(0);
    });
    it('rejects withdrawal by another user, permits own withdrawal, and rejects post-reservation withdrawal', async () => {
        const r = await create();
        await expect(actOnOpenRequest(context(), await user(2), r.id, 'WITHDRAW')).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await actOnOpenRequest(context(), await user(1), r.id, 'WITHDRAW');
        expect((await listOpenRequests(context(), await user(1), profileName)).requests).toHaveLength(0);
        const next = await create();
        await (await caller(3)).admin.openRequests.decide({ id: next.id, action: 'ACCEPT' });
        await expect(actOnOpenRequest(context(), await user(1), next.id, 'WITHDRAW')).rejects.toMatchObject({
            code: 'CONFLICT',
        });
    });
    it('hides expired requests and refuses late approval without operation side effects', async () => {
        const r = await create();
        // Keep DB temporal constraints valid while simulating an expired proposal.
        await prisma.gatewayOpenRequest.update({
            where: { id: r.id },
            data: { createdAt: new Date(Date.now() - 2 * 86_400_000), expiresAt: new Date(Date.now() - 86_400_000) },
        });
        expect((await listOpenRequests(context(), await user(1), profileName)).requests).toHaveLength(0);
        await expect((await caller(3)).admin.openRequests.decide({ id: r.id, action: 'ACCEPT' })).rejects.toMatchObject(
            { code: 'CONFLICT' }
        );
        expect(await prisma.gatewayOperation.count({ where: { profileName } })).toBe(0);
    });
    it('refuses stale seasons and a game reopened before approval', async () => {
        const r = await create();
        await prisma.gatewayProfile.update({ where: { profileName }, data: { openAt: new Date() } });
        await expect((await caller(3)).admin.openRequests.decide({ id: r.id, action: 'ACCEPT' })).rejects.toMatchObject(
            { code: 'CONFLICT' }
        );
        await prisma.gatewayProfile.update({ where: { profileName }, data: { openAt: null, status: 'RUNNING' } });
        await expect((await caller(3)).admin.openRequests.decide({ id: r.id, action: 'ACCEPT' })).rejects.toMatchObject(
            { code: 'CONFLICT' }
        );
    });
    it('serializes approval against existing operations and leaves proposal pending on build incompatibility', async () => {
        const r = await create();
        vi.mocked(catalog.supportsProfileReleaseBuild).mockResolvedValue(false);
        await expect((await caller(3)).admin.openRequests.decide({ id: r.id, action: 'ACCEPT' })).rejects.toMatchObject(
            { code: 'BAD_REQUEST' }
        );
        expect((await prisma.gatewayOpenRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('PENDING');
        vi.mocked(catalog.supportsProfileReleaseBuild).mockResolvedValue(true);
        await profiles.createOperation({ profileName, type: 'START', requestedBy: ids[3]! });
        await expect((await caller(3)).admin.openRequests.decide({ id: r.id, action: 'ACCEPT' })).rejects.toMatchObject(
            { code: 'CONFLICT' }
        );
    });
    it('immediately applies a lowered consensus threshold to existing agreements', async () => {
        await policy(3);
        const r = await create();
        await actOnOpenRequest(context(), await user(2), r.id, 'ENDORSE');
        await prisma.appUser.update({
            where: { id: ids[3] },
            data: { roles: [`admin.profiles.settings:${profileName}`] },
        });
        await (
            await caller(3)
        ).admin.openRequests.updatePolicy({
            profileName,
            policy: { enabled: true, lifetimeDays: 7, buildLeadMinutes: 10, endorsementThreshold: 1 },
            reason: '동의 기준 조정',
        });
        expect((await prisma.gatewayOpenRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('RESERVED');
    });
    it('rolls back a deciding endorsement if reservation fails and supports retry', async () => {
        await policy(1);
        const r = await create();
        vi.mocked(catalog.supportsProfileReleaseBuild).mockResolvedValue(false);
        await expect(actOnOpenRequest(context(), await user(2), r.id, 'ENDORSE')).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
        expect(await prisma.gatewayOpenEndorsement.count({ where: { requestId: r.id } })).toBe(0);
        vi.mocked(catalog.supportsProfileReleaseBuild).mockResolvedValue(true);
        await expect(actOnOpenRequest(context(), await user(2), r.id, 'ENDORSE')).resolves.toMatchObject({
            status: 'RESERVED',
        });
    });
    it('rejects equal, past and insufficient-lead dates and conflicting edits', async () => {
        const input = install();
        await expect(
            createOpenRequest(context(), await user(1), profileName, { ...input, preopenAt: input.openAt })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(
            createOpenRequest(context(), await user(1), profileName, {
                ...input,
                preopenAt: new Date(Date.now() + 60_000).toISOString(),
            })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await create();
        await expect(
            createOpenRequest(context(), await user(1), profileName, { ...input, turnTermMinutes: 8 })
        ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
    it('rejects a different-profile opener and policy changes by an ordinary member', async () => {
        const r = await create();
        await prisma.appUser.update({
            where: { id: ids[3] },
            data: { roles: ['admin.scenarios.reset:other:default'] },
        });
        await expect((await caller(3)).admin.openRequests.decide({ id: r.id, action: 'ACCEPT' })).rejects.toMatchObject(
            { code: 'FORBIDDEN' }
        );
        await expect(
            (await caller(2)).admin.openRequests.updatePolicy({
                profileName,
                policy: { enabled: true, lifetimeDays: 7, buildLeadMinutes: 10, endorsementThreshold: 1 },
                reason: '권한 거부 확인',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(await prisma.gatewayOperation.count({ where: { profileName } })).toBe(0);
    });
    it.runIf(process.env.OPEN_REQUEST_BROWSER === '1')(
        'persists and approves through Chromium, actual HTTP and PostgreSQL',
        async () => {
            const { chromium } = await import('@playwright/test');
            await policy(2);
            const address = await app.listen({ host: '127.0.0.1', port: 0 });
            const browser = await chromium.launch({ headless: true });
            const browserContext = await browser.newContext({
                viewport: { width: 1200, height: 900 },
                deviceScaleFactor: 1,
                locale: 'ko-KR',
                timezoneId: 'Asia/Seoul',
                colorScheme: 'dark',
            });
            const session = await sessions.createSession(await user(1));
            await browserContext.addInitScript((token) => {
                if (!localStorage.getItem('sammo-session-token')) localStorage.setItem('sammo-session-token', token);
            }, session.sessionToken);
            const page = await browserContext.newPage();
            const artifactDir = path.join(repositoryRoot, 'test-results/open-request-live');
            await fs.mkdir(artifactDir, { recursive: true });
            try {
                await page.goto(`${address}/gateway/open-suggestion`);
                await page.getByTestId('proposal-preopen').fill('2099-08-18T11:30');
                await page.getByTestId('proposal-open').fill('2099-08-18T12:00');
                await page.getByTestId('submit-open-request').click();
                await page.locator('.request-card').waitFor();
                const row = await prisma.gatewayOpenRequest.findFirstOrThrow({ where: { profileName } });
                expect(row.preopenAt.toISOString()).toBe('2099-08-18T02:30:00.000Z');
                expect(row.requestedBy).toBe(ids[1]);
                await page.reload();
                await page.locator('.request-card').waitFor();
                const voterSession = await sessions.createSession(await user(2));
                await page.evaluate(
                    (token) => localStorage.setItem('sammo-session-token', token),
                    voterSession.sessionToken
                );
                await page.reload();
                const endorse = page.getByRole('button', { name: '동의', exact: true });
                await endorse.waitFor();
                await endorse.hover();
                await endorse.focus();
                await endorse.click();
                await page.getByRole('button', { name: '동의 완료', exact: true }).waitFor();
                expect(await prisma.gatewayOpenEndorsement.count({ where: { requestId: row.id } })).toBe(1);
                await page.screenshot({ path: path.join(artifactDir, 'pending-endorsement.png'), fullPage: true });
                const openerSession = await sessions.createSession(await user(3));
                await page.evaluate(
                    (token) => localStorage.setItem('sammo-session-token', token),
                    openerSession.sessionToken
                );
                await page.reload();
                const accept = page.getByRole('button', { name: '수락하여 오픈 예약' });
                await accept.waitFor();
                await accept.hover();
                await accept.focus();
                await accept.click();
                await page.locator('.request-card').filter({ hasText: '준비 예약' }).waitFor();
                const reserved = await prisma.gatewayOpenRequest.findUniqueOrThrow({ where: { id: row.id } });
                expect(reserved.status).toBe('RESERVED');
                expect(await prisma.gatewayOperation.count({ where: { id: reserved.operationId! } })).toBe(1);
                for (const viewport of [
                    { width: 1200, height: 900 },
                    { width: 390, height: 844 },
                ]) {
                    await page.setViewportSize(viewport);
                    await page.evaluate('document.fonts.ready');
                    await page.locator('.request-card summary').click();
                    const measurements = await page.locator('.request-list').evaluate((element) => {
                        const rect = element.getBoundingClientRect(),
                            style = element.ownerDocument.defaultView!.getComputedStyle(element);
                        return {
                            rect: rect.toJSON(),
                            font: style.font,
                            color: style.color,
                            documentWidth: element.ownerDocument.documentElement.scrollWidth,
                            viewportWidth: element.ownerDocument.defaultView!.innerWidth,
                            html: element.outerHTML,
                        };
                    });
                    expect(measurements.documentWidth).toBe(viewport.width);
                    await fs.writeFile(
                        path.join(artifactDir, `requests-${viewport.width}.json`),
                        JSON.stringify(measurements, null, 2)
                    );
                    await page.screenshot({
                        path: path.join(artifactDir, `requests-${viewport.width}.png`),
                        fullPage: true,
                    });
                }
            } catch (error) {
                await fs.writeFile(path.join(artifactDir, 'failure.html'), await page.content());
                await page.screenshot({ path: path.join(artifactDir, 'failure.png'), fullPage: true });
                throw error;
            } finally {
                await browser.close();
            }
        },
        60_000
    );
    it('enforces authentication and rejects user-supplied actor, source and build time over real HTTP', async () => {
        const unauth = await app.inject({
            method: 'POST',
            url: '/gateway/api/trpc/openRequests.create',
            payload: { profileName, install: install() },
        });
        expect(unauth.statusCode).toBe(401);
        const session = await sessions.createSession(await user(1));
        for (const extra of [
            { requestedBy: ids[3] },
            { scheduledAt: new Date().toISOString() },
            { sourceMode: 'BRANCH', sourceRef: 'evil' },
        ]) {
            const response = await app.inject({
                method: 'POST',
                url: '/gateway/api/trpc/openRequests.create',
                headers: { 'x-session-token': session.sessionToken },
                payload: { profileName, install: install(), ...extra },
            });
            expect(response.statusCode).toBe(400);
        }
        const success = await app.inject({
            method: 'POST',
            url: '/gateway/api/trpc/openRequests.create',
            headers: { 'x-session-token': session.sessionToken },
            payload: { profileName, install: install() },
        });
        expect(success.statusCode).toBe(200);
        expect(await prisma.gatewayOpenRequest.count({ where: { profileName } })).toBe(1);
    });
});
