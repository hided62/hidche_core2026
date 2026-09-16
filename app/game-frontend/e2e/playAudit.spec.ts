import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { gamePath, gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const world = {
    year: 190,
    month: 7,
    startYear: 190,
    startMonth: 1,
    serverId: 'audit-fixture',
    tick: '100',
    asOf: '2026-09-16T00:00:00.000Z',
    collectionStart: { year: 190, month: 1, tick: '0', observedAt: '2026-09-16T00:00:00.000Z' },
};
const dex = { dex1: 100, dex2: 200, dex3: 300, dex4: 400, dex5: 500 };
const population = { count: 2, gold: 200, rice: 400, dex, averageGold: 100, averageRice: 200, averageDex: dex };
const general = {
    id: 1,
    name: '감사장수',
    userId: 'fixture',
    nationId: 2,
    cityId: 3,
    troopId: 0,
    npcState: 2,
    gold: 1200,
    rice: 2400,
    stats: { leadership: 80, strength: 70, intelligence: 90 },
    experience: 100,
    dedication: 200,
    officerLevel: 2,
    injury: 0,
    age: 30,
    crew: 5000,
    crewTypeId: 1,
    train: 80,
    atmos: 90,
    dex,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
};
const decision = {
    id: 'd'.repeat(64),
    executionId: 'e'.repeat(64),
    phase: 'general',
    generalId: 1,
    nationId: 2,
    cityId: 3,
    npcState: 2,
    year: 190,
    month: 6,
    tick: '100',
    stepCount: 129,
    createdAt: '2026-09-16T00:00:00.000Z',
    summary: {
        schemaVersion: 1,
        coverage: 'PROCEDURES',
        executionCoverage: 'ATTEMPTS',
        clockRevision: 1,
        codeVersion: null,
        policyRefs: { DEFENCE: 'a'.repeat(64) },
        requestedAction: '휴식',
        selectedAction: 'che_징병',
        selectedReason: '징병 선택',
        executedAction: '휴식',
        completed: false,
        usedFallback: true,
        blockedReason: '자원 부족',
    },
};
const install = async (
    page: Page,
    denied = false,
    baseline: boolean | 'document' | 'created' | 'removed' = false,
    executionStatus?: 'PREPARING' | 'BLOCKED'
) => {
    const requests: { operation: string; input: Record<string, unknown> }[] = [];
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_audit');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route(gameTrpcRoute, async (route) => {
        const url = new URL(route.request().url());
        const inputs = JSON.parse(url.searchParams.get('input') ?? route.request().postData() ?? '{}');
        const results = decodeURIComponent(url.pathname.split('/trpc/')[1] ?? '')
            .split(',')
            .map((operation, index) => {
                const input = inputs[index] ?? {};
                requests.push({ operation, input });
                const result = (data: unknown) => ({ result: { data } });
                switch (operation) {
                    case 'auth.status':
                        return result({ ok: true });
                    case 'lobby.info':
                        return result({ myGeneral: null });
                    case 'playAudit.capabilities':
                        return denied
                            ? {
                                  error: {
                                      message: '이 프로필의 플레이 감사 권한이 필요합니다.',
                                      code: -32003,
                                      data: { code: 'FORBIDDEN', httpStatus: 403 },
                                  },
                              }
                            : result({ profileName: gameProfile, read: true, accounts: false });
                    case 'playAudit.requestState':
                        return result({
                            ...world,
                            coverage: 'CURRENT_JOURNAL_STATE',
                            status: input.kind === 'POLICY' && input.id === 'a'.repeat(64) ? 'NOT_LINKED' : 'AVAILABLE',
                            request:
                                input.kind === 'POLICY' && input.id === 'a'.repeat(64)
                                    ? null
                                    : {
                                          sequence: '9007199254740993',
                                          requestId: 'fixture-request',
                                          target: 'ENGINE',
                                          eventType: 'setNpcPolicy',
                                          status: 'SUCCEEDED',
                                          attempts: 2,
                                          acceptedGameTick: null,
                                          processingGameTick: '4320000000',
                                          acceptedClockRevision: null,
                                          processingClockRevision: '3',
                                          createdAt: world.asOf,
                                          processingAt: world.asOf,
                                          completedAt: world.asOf,
                                          resultRecorded: true,
                                          errorRecorded: false,
                                      },
                        });
                    case 'playAudit.decisionHistory':
                        return result({
                            ...world,
                            month: input.month ?? { year: 190, month: 7 },
                            coverage: 'PROCEDURES_ONLY',
                            items: [
                                {
                                    ...decision,
                                    summary: { ...decision.summary, executionStatus },
                                    id: input.cursor ? 'c'.repeat(64) : decision.id,
                                    phase: input.cursor ? 'nation' : 'general',
                                },
                            ],
                            nextCursor: input.cursor ? null : { tick: '100', id: decision.id },
                        });
                    case 'playAudit.decisionDetail':
                        return result({
                            ...world,
                            decision: { ...decision, summary: { ...decision.summary, executionStatus } },
                            chunks: [
                                {
                                    ordinal: input.cursor === undefined ? 0 : 1,
                                    steps: [
                                        {
                                            phase: 'general',
                                            generalId: 1,
                                            nationId: 2,
                                            cityId: 3,
                                            npcState: 2,
                                            year: 190,
                                            month: 6,
                                            tick: 100,
                                            sequence: input.cursor === undefined ? 0 : 128,
                                            ...(input.cursor === undefined
                                                ? { kind: 'PROCEDURE_START', procedure: '<b>징병판정</b>' }
                                                : {
                                                      kind: 'EXECUTION_ATTEMPT',
                                                      attempt: 0,
                                                      requestedAction: 'che_징병',
                                                      resolvedAction: 'che_징병',
                                                      executedAction: '휴식',
                                                      completed: true,
                                                      usedFallback: true,
                                                      alternativeAction: null,
                                                      preparation: null,
                                                      checks: [
                                                          {
                                                              stage: 'CONSTRAINT',
                                                              action: 'che_징병',
                                                              result: 'deny',
                                                              reason: '<b>자원 부족</b>',
                                                          },
                                                      ],
                                                  }),
                                        },
                                    ],
                                },
                            ],
                            nextCursor: input.cursor === undefined ? 0 : null,
                        });
                    case 'playAudit.generalLogs':
                        return result({
                            ...world,
                            type: input.type,
                            coverage: 'IDENTIFIED_LOGS_ONLY',
                            items: [
                                {
                                    id: 1,
                                    year: 190,
                                    month: 1,
                                    text: `<script>window.auditInjected=true</script>${input.type} 감사 로그`,
                                    createdAt: '0190-01-01T00:00:00.000Z',
                                },
                            ],
                            nextCursor: null,
                        });
                    case 'playAudit.diplomacyHistory':
                        if (baseline)
                            return result({
                                ...world,
                                coverage: 'RECORDED_EVENTS_ONLY',
                                nextCursor: null,
                                items: [
                                    {
                                        id: 'c'.repeat(64),
                                        sequence: '1',
                                        srcNationId: 2,
                                        destNationId: 3,
                                        category: baseline === 'document' ? 'DOCUMENT' : 'RELATION',
                                        source: 'BASELINE',
                                        eventType:
                                            baseline === 'document'
                                                ? 'LETTER_BASELINE'
                                                : baseline === 'created'
                                                  ? 'NATION_RELATION_CREATED'
                                                  : baseline === 'removed'
                                                    ? 'NATION_RELATION_REMOVED'
                                                    : 'RELATION_BASELINE',
                                        documentId: baseline === 'document' ? 8 : null,
                                        previousDocumentId: null,
                                        year: 190,
                                        month: 1,
                                        actor: null,
                                        createdAt: world.asOf,
                                    },
                                ],
                            });
                        return result({
                            ...world,
                            coverage: 'RECORDED_EVENTS_ONLY',
                            nextCursor: input.cursor ? null : '9007199254741001',
                            items: [
                                {
                                    id: (input.cursor ? 'e' : 'd').repeat(64),
                                    sequence: input.cursor ? '9007199254741000' : '9007199254741001',
                                    srcNationId: 2,
                                    destNationId: 3,
                                    category: 'DOCUMENT',
                                    source: 'API',
                                    eventType: input.cursor ? 'LETTER_DESTROYED' : 'LETTER_ACCEPTED',
                                    documentId: 8,
                                    previousDocumentId: 7,
                                    year: 190,
                                    month: 6,
                                    actor: {
                                        generalId: 1,
                                        name: '당시 외교권자',
                                        nationId: 2,
                                        officerLevel: 12,
                                        npcState: 0,
                                    },
                                    createdAt: world.asOf,
                                },
                            ],
                        });
                    case 'playAudit.diplomacyEvent':
                        if (baseline)
                            return result({
                                ...world,
                                event: {
                                    id: input.id,
                                    sequence: '1',
                                    srcNationId: 2,
                                    destNationId: 3,
                                    category: baseline === 'document' ? 'DOCUMENT' : 'RELATION',
                                    source: 'BASELINE',
                                    eventType:
                                        baseline === 'document'
                                            ? 'LETTER_BASELINE'
                                            : baseline === 'created'
                                              ? 'NATION_RELATION_CREATED'
                                              : baseline === 'removed'
                                                ? 'NATION_RELATION_REMOVED'
                                                : 'RELATION_BASELINE',
                                    documentId: baseline === 'document' ? 8 : null,
                                    previousDocumentId: null,
                                    year: 190,
                                    month: 1,
                                    actor: null,
                                    createdAt: world.asOf,
                                    before: baseline === 'removed' ? { state: 7, term: 12, dead: 0 } : null,
                                    after:
                                        baseline === 'document'
                                            ? { state: 'ACTIVATED' }
                                            : baseline === 'removed'
                                              ? null
                                              : { state: 2, term: 0, dead: 0 },
                                    tick: '0',
                                    clockRevision: '1',
                                    ordinal: 1,
                                    executionId: 'relation-baseline',
                                    requestId: null,
                                    inputSequence: null,
                                    documentStatus: baseline === 'document' ? 'AVAILABLE' : 'NOT_APPLICABLE',
                                    document:
                                        baseline === 'document'
                                            ? {
                                                  id: 8,
                                                  writtenAt: '2026-09-01T00:00:00.000Z',
                                                  brief: '보유 협정',
                                                  briefHtml: '<p>보유 협정</p>',
                                                  detail: '<p>도입 전 본문</p>',
                                                  detailHtml: '<p>도입 전 본문</p>',
                                              }
                                            : null,
                                },
                            });
                        return result({
                            ...world,
                            event: {
                                id: input.id,
                                sequence: '9007199254741001',
                                srcNationId: 2,
                                destNationId: 3,
                                category: 'DOCUMENT',
                                source: 'API',
                                eventType: 'LETTER_ACCEPTED',
                                documentId: 8,
                                previousDocumentId: 7,
                                year: 190,
                                month: 6,
                                actor: {
                                    generalId: 1,
                                    name: '당시 외교권자',
                                    nationId: 2,
                                    officerLevel: 12,
                                    npcState: 0,
                                },
                                createdAt: world.asOf,
                                before: { state: 'PROPOSED' },
                                after: { state: 'ACTIVATED' },
                                tick: '100',
                                clockRevision: '1',
                                ordinal: 1,
                                executionId: 'fixture',
                                requestId: 'fixture-request',
                                inputSequence: '9007199254740993',
                                documentStatus: String(input.id).startsWith('e') ? 'HASH_MISMATCH' : 'AVAILABLE',
                                document: String(input.id).startsWith('e')
                                    ? null
                                    : {
                                          id: 8,
                                          writtenAt: world.asOf,
                                          brief: '협정',
                                          briefHtml: '<p>협정</p>',
                                          detail: '<script>window.auditInjected=true</script><p>서명된 내용</p>',
                                          detailHtml: '<p><b>서명된 내용</b></p>',
                                      },
                            },
                        });
                    case 'playAudit.policyHistory':
                        return result({
                            ...world,
                            coverage: 'RECORDED_VERSIONS_ONLY',
                            items: [
                                {
                                    id: String(input.cursor ? 'a' : 'b').repeat(64),
                                    nationId: 2,
                                    area: input.area,
                                    revision: input.cursor ? 1 : 2,
                                    source: input.cursor ? 'BASELINE' : 'CHANGE',
                                    year: 190,
                                    month: 6,
                                    previousId: input.cursor ? null : 'a'.repeat(64),
                                    actor: input.cursor
                                        ? null
                                        : {
                                              generalId: 1,
                                              name: '당시군주',
                                              nationId: 2,
                                              officerLevel: 12,
                                              npcState: 0,
                                          },
                                    createdAt: world.asOf,
                                },
                            ],
                            nextCursor: input.cursor ? null : 2,
                        });
                    case 'playAudit.policyVersion': {
                        const baseline = input.id === 'a'.repeat(64);
                        return result({
                            ...world,
                            version: {
                                id: input.id,
                                nationId: 2,
                                area: 'DEFENCE',
                                revision: baseline ? 1 : 2,
                                source: baseline ? 'BASELINE' : 'CHANGE',
                                year: 190,
                                month: 6,
                                previousId: baseline ? null : 'a'.repeat(64),
                                actor: baseline
                                    ? null
                                    : { generalId: 1, name: '당시군주', nationId: 2, officerLevel: 12, npcState: 0 },
                                createdAt: world.asOf,
                                tick: '100',
                                ordinal: baseline ? 1 : 2,
                                requestId: baseline ? null : 'policy-request-fixture',
                                inputSequence: baseline ? null : '9007199254740993',
                                fields: [
                                    {
                                        key: 'scout',
                                        beforeJson: baseline ? null : '0',
                                        afterJson: '1',
                                        changed: !baseline,
                                    },
                                    {
                                        key: 'priority',
                                        beforeJson: baseline ? null : 'null',
                                        afterJson: '["<script>window.auditInjected=true</script>"]',
                                        changed: !baseline,
                                    },
                                ],
                            },
                        });
                    }
                    case 'playAudit.coverage':
                        return result({ ...world, status: 'COLLECTED', samples: [], nextCursor: null });
                    case 'playAudit.nations':
                        return result({
                            ...world,
                            collected: true,
                            items: [{ id: 2, name: '촉', color: '#ff0000' }],
                            nextCursor: null,
                        });
                    case 'playAudit.nationSeries':
                        return result({
                            ...world,
                            nextCursor: null,
                            items: [
                                {
                                    year: 190,
                                    month: 1,
                                    periodMonths: 6,
                                    complete: true,
                                    from: { year: 190, month: 1 },
                                    to: { year: 190, month: 6 },
                                    stockAsOf: { year: 190, month: 6 },
                                    stock: {
                                        id: 2,
                                        name: '촉',
                                        color: '#ff0000',
                                        gold: 600,
                                        rice: 1200,
                                        tech: 100,
                                        appliedRate: 20,
                                        populations: { human: population, npc: population, troopNpc: population },
                                    },
                                    flows: { incomeGold: 21, incomeRice: null, paidGold: 10, paidRice: 0 },
                                    months: [1, 2, 3, 4, 5, 6].map((month) => ({
                                        year: 190,
                                        month,
                                        collected: true,
                                        nationPresent: true,
                                        settlementsComplete: true,
                                    })),
                                },
                            ],
                        });
                    case 'playAudit.nationSnapshot':
                        return result({
                            ...world,
                            collected: true,
                            sample: {
                                year: 190,
                                month: 6,
                                kind: (input.at as { kind: string }).kind,
                                settlementsComplete: (input.at as { kind: string }).kind !== 'INITIAL',
                            },
                            nation: {
                                id: 2,
                                name: '촉',
                                color: '#ff0000',
                                gold: 999,
                                rice: 222,
                                tech: 100,
                                appliedRate: 20,
                                incomeGold: 99,
                                incomeRice: 0,
                                paidGold: 0,
                                paidRice: 0,
                                populations: { human: population, npc: population, troopNpc: population },
                            },
                        });
                    case 'playAudit.generals':
                        return result({
                            ...world,
                            collected: !input.at || (input.at as { month: number }).month !== 7,
                            sample: input.at ?? null,
                            nextCursor: input.cursor ? null : 1,
                            items:
                                input.at && (input.at as { month: number }).month === 7
                                    ? []
                                    : [
                                          {
                                              ...general,
                                              id: input.cursor ? 2 : 1,
                                              name: input.cursor ? '다음장수' : '감사장수',
                                          },
                                      ],
                        });
                    case 'playAudit.generalDetail':
                        return result({
                            ...world,
                            sample: input.at ?? null,
                            collected: true,
                            general: { ...general, name: input.at ? '과거감사장수' : general.name },
                            nation: { id: 2, name: '촉' },
                            city: { id: 3, name: '성도' },
                        });
                    case 'playAudit.cityDetail':
                        return result({
                            ...world,
                            collected: true,
                            sample: input.at ?? null,
                            nation: { id: 2, name: '촉' },
                            city: {
                                id: 3,
                                name: '성도',
                                nationId: 2,
                                level: 4,
                                state: 0,
                                population: 10000,
                                populationMax: 20000,
                                agriculture: 100,
                                agricultureMax: 200,
                                commerce: 100,
                                commerceMax: 200,
                                security: 100,
                                securityMax: 200,
                                wall: 100,
                                wallMax: 200,
                                defence: 100,
                                defenceMax: 200,
                                supplyState: 1,
                                frontState: 0,
                                trust: 80,
                            },
                        });
                    case 'playAudit.generalTurns':
                        return result({
                            ...world,
                            currentOnly: true,
                            generalExists: true,
                            items: [{ turnIdx: 0, actionCode: '휴식', argumentJson: '{}' }],
                            nextCursor: null,
                        });
                    case 'playAudit.cities':
                        return result({
                            ...world,
                            collected: true,
                            sample: null,
                            nextCursor: null,
                            items: [
                                {
                                    id: 3,
                                    name: '성도',
                                    nationId: 2,
                                    level: 4,
                                    state: 0,
                                    population: 10000,
                                    populationMax: 20000,
                                    agriculture: 100,
                                    agricultureMax: 200,
                                    commerce: 100,
                                    commerceMax: 200,
                                    security: 100,
                                    securityMax: 200,
                                    wall: 100,
                                    wallMax: 200,
                                    defence: 100,
                                    defenceMax: 200,
                                    supplyState: 1,
                                    frontState: 0,
                                    trust: 80,
                                },
                            ],
                        });
                    default:
                        throw new Error(`Unexpected operation ${operation}`);
                }
            });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
    return requests;
};

const capture = async (page: Page, name: string) => {
    await page.evaluate(() => document.fonts.ready);
    const directory = resolve('/tmp/play-audit-browser', gameProfile.replace(':', '-'));
    await mkdir(directory, { recursive: true });
    const geometry = await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        width: document.documentElement.scrollWidth,
        nodes: [...document.querySelectorAll('.audit-page, .panel-card, select, input, button, table')].map((node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {
                tag: node.tagName,
                width: rect.width,
                height: rect.height,
                x: rect.x,
                y: rect.y,
                font: style.fontSize,
                background: style.backgroundColor,
            };
        }),
    }));
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport.width);
    await writeFile(resolve(directory, `${name}.json`), JSON.stringify(geometry, null, 2));
    await writeFile(resolve(directory, `${name}.html`), await page.content());
    await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
};

test('profile audit without a general: chart controls, lazy reads, direct reload', async ({ page }) => {
    const requests = await install(page);
    await page.goto(gamePath('/play-audit?tab=nations&nation=2&fromYear=190&fromMonth=1&year=190&month=6'));
    await expect(page.getByRole('cell', { name: '600', exact: true })).toBeVisible();
    expect(requests.some((request) => ['playAudit.generals', 'playAudit.cities'].includes(request.operation))).toBe(
        false
    );
    const count = requests.length;
    await page.getByLabel('지표', { exact: true }).selectOption('incomeGold');
    await expect(page.getByRole('cell', { name: '21', exact: true })).toBeVisible();
    await page.getByLabel('지표', { exact: true }).selectOption('incomeRice');
    await expect(page.getByRole('cell', { name: '자료 없음', exact: true })).toBeVisible();
    expect(requests.length).toBe(count);
    await page.getByText('월별 표본 수집됨', { exact: true }).click();
    await expect(page.getByText('190년 1월: 수집됨')).toBeVisible();
    await capture(page, 'desktop-series');
    await page.reload();
    await expect(page.getByRole('cell', { name: '600', exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(gamePath('/play-audit'));
});

test('mobile city drilldown preserves month and includes foreign stationed generals', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requests = await install(page);
    await page.goto(gamePath('/play-audit?tab=cities&nation=2&at=month&year=190&month=6'));
    await page.getByText('내정 보기', { exact: true }).click();
    await expect(page.getByText(/농업 100 \/ 200/)).toBeVisible();
    await capture(page, 'mobile-cities');
    await page.getByRole('button', { name: '모든 국가의 주둔 장수' }).click();
    await expect(page.getByRole('rowheader', { name: /감사장수/ })).toBeVisible();
    const input = requests.filter((request) => request.operation === 'playAudit.generals').at(-1)?.input;
    expect(input).toMatchObject({ cityId: 3, at: { year: 190, month: 6, kind: 'MONTH_END' } });
    expect(input).not.toHaveProperty('nationId');
    await page.getByText('상세 보기', { exact: true }).click();
    await expect(page.getByText(/통솔 80/)).toBeVisible();
    await capture(page, 'mobile-generals');
    await page.getByRole('button', { name: '다음 50개 불러오기' }).click();
    await expect(page.getByRole('rowheader', { name: /다음장수/ })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('rowheader', { name: /성도/ })).toBeVisible();
    await page.goto(gamePath('/play-audit?tab=generals&at=month&year=190&month=7'));
    await expect(page.getByText('선택한 시점의 표본이 없습니다.')).toBeVisible();
});

test('denied capability does not request game audit data', async ({ page }) => {
    const requests = await install(page, true);
    await page.goto(gamePath('/play-audit'));
    await expect(page.getByRole('alert')).toContainText('플레이 감사 권한');
    expect(
        requests.filter((request) => request.operation.startsWith('playAudit.')).map((request) => request.operation)
    ).toEqual(['playAudit.capabilities']);
    await expect(page.getByLabel('조회 대상')).toHaveCount(0);
});

test('back navigation during a slow read keeps the newer city view', async ({ page }) => {
    await install(page);
    let release = () => {};
    let markStarted = () => {};
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });
    await page.route(gameTrpcRoute, async (route) => {
        if (route.request().url().includes('playAudit.generals')) {
            markStarted();
            await held;
        }
        await route.fallback();
    });
    await page.goto(gamePath('/play-audit?tab=cities'));
    await page.getByRole('button', { name: '모든 국가의 주둔 장수' }).click();
    await started;
    await expect(page.getByRole('button', { name: '조회', exact: true })).toBeDisabled();
    await page.goBack();
    await expect(page.getByRole('rowheader', { name: /성도/ })).toBeVisible();
    const response = page.waitForResponse((response) => response.url().includes('playAudit.generals'));
    release();
    await response;
    await expect(page.getByRole('rowheader', { name: /성도/ })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: /감사장수/ })).toHaveCount(0);
    await page.getByRole('button', { name: '조회', exact: true }).focus();
    await expect(page.getByRole('button', { name: '조회', exact: true })).toBeFocused();
});

test('final nation snapshot is separate from the monthly series', async ({ page }) => {
    const requests = await install(page);
    await page.goto(gamePath('/play-audit?tab=nations&nation=2&at=final&year=190&month=6'));
    await expect(page.getByRole('heading', { name: '촉 · 190년 6월 최종 표본' })).toBeVisible();
    await expect(page.getByText('999 / 222', { exact: true })).toBeVisible();
    expect(requests.some((request) => request.operation === 'playAudit.nationSeries')).toBe(false);
    expect(requests.find((request) => request.operation === 'playAudit.nationSnapshot')?.input).toEqual({
        nationId: 2,
        at: { year: 190, month: 6, kind: 'FINAL' },
    });
    await capture(page, 'final-nation');
});

test('selected general reads detail on demand and separates current reservations from history', async ({ page }) => {
    const requests = await install(page);
    await page.goto(gamePath('/play-audit?tab=generals'));
    await expect(page.getByRole('button', { name: '감사장수 (#1)', exact: true })).toBeVisible();
    const before = requests.filter((request) => request.operation === 'playAudit.generals').length;
    await page.getByRole('button', { name: '감사장수 (#1)', exact: true }).click();
    await expect(page.getByRole('heading', { name: '선택 장수 상세' })).toBeVisible();
    await expect(page.getByText('국가 촉 · 도시 성도 · 부대 #0', { exact: true })).toBeVisible();
    expect(requests.filter((request) => request.operation === 'playAudit.generals')).toHaveLength(before);
    expect(requests.some((request) => request.operation === 'playAudit.generalTurns')).toBe(false);
    await page.getByRole('button', { name: '현재 예약 명령 조회', exact: true }).click();
    await expect(page.getByText(/위치 0: 휴식/)).toBeVisible();
    await capture(page, 'general-detail');
    await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '선택 장수 상세' })).toHaveCount(0);
    await page.goto(gamePath('/play-audit?tab=generals&general=1&at=month&year=190&month=6'));
    await expect(page.getByRole('heading', { name: '과거감사장수 (#1)' })).toBeVisible();
    await expect(page.getByText('과거 예약 명령은 상태 표본에 포함되지 않습니다.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '현재 예약 명령 조회', exact: true })).toHaveCount(0);
    expect(requests.filter((request) => request.operation === 'playAudit.generalTurns')).toHaveLength(1);
});

test('city detail is addressable without reloading the list and retains month for stationed generals', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requests = await install(page);
    await page.goto(gamePath('/play-audit?tab=cities&at=month&year=190&month=6'));
    const button = page.getByRole('button', { name: '성도 (#3)', exact: true });
    await expect(button).toBeVisible();
    const before = requests.filter((request) => request.operation === 'playAudit.cities').length;
    await button.click();
    await expect(page.getByRole('heading', { name: '성도 (#3) · 촉' })).toBeVisible();
    expect(requests.filter((request) => request.operation === 'playAudit.cities')).toHaveLength(before);
    await capture(page, 'city-detail-mobile');
    await page.getByRole('button', { name: '이 시점의 모든 국가 주둔 장수', exact: true }).click();
    await expect(page.getByRole('rowheader', { name: /감사장수/ })).toBeVisible();
    expect(requests.filter((request) => request.operation === 'playAudit.generals').at(-1)?.input).toMatchObject({
        cityId: 3,
        at: { year: 190, month: 6, kind: 'MONTH_END' },
    });
});

test('general logs load explicitly and cache each category without reloading entity lists', async ({ page }) => {
    const requests = await install(page);
    await page.goto(gamePath('/play-audit?tab=generals&general=1'));
    await expect(page.getByRole('button', { name: '장수 기록 조회', exact: true })).toBeVisible();
    expect(requests.filter((r) => r.operation === 'playAudit.generalLogs')).toHaveLength(0);
    await expect(page.getByRole('rowheader', { name: /감사장수/ })).toBeVisible();
    const listCount = requests.filter((r) => r.operation === 'playAudit.generals').length;
    await page.getByRole('button', { name: '장수 기록 조회', exact: true }).click();
    await expect(page.getByText('generalHistory 감사 로그', { exact: false })).toBeVisible();
    await page.getByLabel('기록 종류').selectOption('generalAction');
    await expect(page.getByText('generalAction 감사 로그', { exact: false })).toBeVisible();
    await page.getByLabel('기록 종류').selectOption('generalHistory');
    await expect(page.getByText('generalHistory 감사 로그', { exact: false })).toBeVisible();
    expect(requests.filter((r) => r.operation === 'playAudit.generalLogs')).toHaveLength(2);
    expect(requests.filter((r) => r.operation === 'playAudit.generals')).toHaveLength(listCount);
    expect(await page.evaluate(() => Reflect.get(window, 'auditInjected'))).toBeUndefined();
    await expect(page.locator('.audit-logs script')).toHaveCount(0);
    await capture(page, 'general-logs');
});

test('historical log failure retries independently and sends only the selected month', async ({ page }) => {
    const requests = await install(page);
    let fail = true;
    await page.route(gameTrpcRoute, async (route) => {
        if (decodeURIComponent(route.request().url()).includes('playAudit.generalLogs') && fail) {
            fail = false;
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify([
                    {
                        error: {
                            message: '기록 조회 재시도',
                            code: -32603,
                            data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
                        },
                    },
                ]),
            });
        } else await route.fallback();
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(gamePath('/play-audit?tab=generals&general=1&at=month&year=190&month=6'));
    await page.getByRole('button', { name: '장수 기록 조회', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('기록 조회 재시도');
    await page.getByRole('button', { name: '다시 조회', exact: true }).click();
    await expect(page.getByText('generalHistory 감사 로그', { exact: false })).toBeVisible();
    expect(requests.filter((r) => r.operation === 'playAudit.generalLogs')[0]?.input).toMatchObject({
        generalId: 1,
        month: { year: 190, month: 6 },
    });
    expect(requests.filter((r) => r.operation === 'playAudit.generalTurns')).toHaveLength(0);
    await capture(page, 'historical-general-logs-mobile');
});

test('initial calendar before the scenario year bounds default periods and month controls', async ({ page }) => {
    const requests = await install(page);
    await page.route(gameTrpcRoute, async (route) => {
        if (decodeURIComponent(route.request().url()).includes('playAudit.coverage')) {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify([
                    {
                        result: {
                            data: {
                                ...world,
                                year: 189,
                                month: 10,
                                startYear: 189,
                                startMonth: 10,
                                status: 'COLLECTED',
                                samples: [],
                                nextCursor: null,
                            },
                        },
                    },
                ]),
            });
        } else await route.fallback();
    });
    await page.goto(gamePath('/play-audit?tab=nations&nation=2'));
    await expect(page.getByLabel('시작 연도', { exact: true })).toHaveValue('189');
    await expect(page.getByLabel('시작 월', { exact: true })).toHaveValue('10');
    await expect(page.getByLabel('시작 월', { exact: true })).toHaveAttribute('min', '10');
    await expect(page.getByLabel('월', { exact: true })).toHaveAttribute('min', '10');
    await expect
        .poll(() => requests.find((r) => r.operation === 'playAudit.nationSeries')?.input)
        .toMatchObject({ from: { year: 189, month: 10 }, to: { year: 189, month: 10 } });
});

test('policy history reads summaries and selected versions only, preserving deep links and pagination', async ({
    page,
}) => {
    const requests = await install(page);
    const path = '/play-audit?tab=policies&nation=2&policyArea=DEFENCE&fromYear=190&fromMonth=1&year=190&month=6';
    await page.goto(gamePath(path));
    await expect(page.getByRole('button', { name: '버전 2', exact: true })).toBeVisible();
    expect(
        requests.some(({ operation }) =>
            ['playAudit.policyVersion', 'playAudit.nationSeries', 'playAudit.generals'].includes(operation)
        )
    ).toBe(false);
    const listReads = requests.filter(({ operation }) => operation === 'playAudit.policyHistory').length;
    const nationReads = requests.filter(({ operation }) => operation === 'playAudit.nations').length;
    await page.getByRole('button', { name: '버전 2', exact: true }).click();
    await expect(page.getByText('임관 권유 설정 (변경)', { exact: true })).toBeVisible();
    await expect(page.getByText(/국가 #2 · 버전 2/)).toBeVisible();
    expect(requests.filter(({ operation }) => operation === 'playAudit.policyHistory')).toHaveLength(listReads);
    expect(requests.filter(({ operation }) => operation === 'playAudit.nations')).toHaveLength(nationReads);
    await page.getByText('요청 연결', { exact: true }).click();
    await expect(page.getByText('입력 순번 9007199254740993', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => Object.hasOwn(window, 'auditInjected'))).toBe(false);
    await capture(page, 'desktop-policy-detail');
    await page.reload();
    await expect(page.getByText(/국가 #2 · 버전 2/)).toBeVisible();
    await page.getByRole('button', { name: '이전 정책 버전', exact: true }).click();
    await expect(page.getByText(/국가 #2 · 버전 1/)).toBeVisible();
    await expect(page.getByRole('cell', { name: '관측하지 않음', exact: true })).toHaveCount(2);
    await page.goBack();
    await expect(page.getByText(/국가 #2 · 버전 2/)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, 'mobile-policy-detail');
    await page.getByRole('button', { name: '정책 상세 닫기' }).click();
    await expect(page.getByRole('heading', { name: /선택 정책 버전/ })).toHaveCount(0);
    await page.getByRole('button', { name: '다음 정책 50개' }).click();
    await expect(page.getByRole('button', { name: '버전 1', exact: true })).toBeVisible();
    expect(requests.filter(({ operation }) => operation === 'playAudit.policyHistory').at(-1)?.input).toMatchObject({
        area: 'DEFENCE',
        cursor: 2,
        nationId: 2,
    });
    await page.getByLabel('정책 영역').selectOption('NPC_GENERAL_PRIORITY');
    const before = requests.filter(({ operation }) => operation === 'playAudit.policyHistory').length;
    await page.getByRole('button', { name: '조회', exact: true }).click();
    await expect
        .poll(() => requests.filter(({ operation }) => operation === 'playAudit.policyHistory').length)
        .toBeGreaterThan(before);
    expect(requests.filter(({ operation }) => operation === 'playAudit.policyHistory').at(-1)?.input.area).toBe(
        'NPC_GENERAL_PRIORITY'
    );
});

test('policy detail failure retries independently without reloading its history', async ({ page }) => {
    const requests = await install(page);
    let fail = true;
    await page.route(gameTrpcRoute, async (route) => {
        if (fail && route.request().url().includes('playAudit.policyVersion')) {
            fail = false;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    {
                        error: {
                            message: '정책 버전 일시 오류',
                            code: -32603,
                            data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
                        },
                    },
                ]),
            });
            return;
        }
        await route.fallback();
    });
    await page.goto(
        gamePath('/play-audit?tab=policies&nation=2&policyArea=DEFENCE&fromYear=190&fromMonth=1&year=190&month=6')
    );
    await page.getByRole('button', { name: '버전 2', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('정책 버전 일시 오류');
    await expect(page.getByRole('button', { name: '버전 2', exact: true })).toBeVisible();
    const count = requests.filter(({ operation }) => operation === 'playAudit.policyHistory').length;
    await page.getByRole('button', { name: '버전 다시 조회', exact: true }).click();
    await expect(page.getByText(/국가 #2 · 버전 2/)).toBeVisible();
    expect(requests.filter(({ operation }) => operation === 'playAudit.policyHistory')).toHaveLength(count);
});

test('policy filter drafts do not read until applied, including default dates', async ({ page }) => {
    const requests = await install(page);
    await page.goto(gamePath('/play-audit?tab=policies&nation=2'));
    await expect(page.getByRole('button', { name: '버전 2', exact: true })).toBeVisible();
    const count = requests.filter(({ operation }) => operation === 'playAudit.policyHistory').length;
    await page.getByLabel('시작 월', { exact: true }).fill('3');
    await page.getByLabel('정책 영역').selectOption('DEFENCE');
    await page.getByRole('button', { name: '조회', exact: true }).focus();
    expect(requests.filter(({ operation }) => operation === 'playAudit.policyHistory')).toHaveLength(count);
    await page.getByRole('button', { name: '조회', exact: true }).click();
    await expect
        .poll(() => requests.filter(({ operation }) => operation === 'playAudit.policyHistory').length)
        .toBe(count + 1);
    expect(requests.filter(({ operation }) => operation === 'playAudit.policyHistory').at(-1)?.input).toMatchObject({
        area: 'DEFENCE',
        from: { year: 190, month: 3 },
    });
});

test('initial observation is separate from month-end and final snapshots', async ({ page }) => {
    const requests = await install(page);
    await page.goto(gamePath('/play-audit?tab=nations&nation=2&at=initial&year=190&month=6'));
    await expect(page.getByRole('heading', { name: '촉 · 190년 6월 수집 시작 기준' })).toBeVisible();
    await expect(page.getByText(/상태·정책 수집 시작: 190년 1월/)).toBeVisible();
    expect(requests.some(({ operation }) => operation === 'playAudit.nationSeries')).toBe(false);
    expect(requests.find(({ operation }) => operation === 'playAudit.nationSnapshot')?.input).toMatchObject({
        at: { kind: 'INITIAL' },
    });
    await page.getByLabel('조회 대상').selectOption('generals');
    await page.getByRole('button', { name: '조회', exact: true }).click();
    await page.getByRole('button', { name: '감사장수 (#1)', exact: true }).click();
    await expect(page.getByText('190년 6월 수집 시작 기준', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '과거감사장수 (#1)' })).toBeVisible();
    expect(requests.filter(({ operation }) => operation === 'playAudit.generalDetail').at(-1)?.input).toMatchObject({
        at: { kind: 'INITIAL' },
    });
    await capture(page, 'initial-observation');
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, 'mobile-initial-observation');
});

test('diplomacy history loads selected safe document details without reloading the list', async ({ page }) => {
    const requests = await install(page);
    await page.goto(
        gamePath('/play-audit?tab=diplomacy&nation=2&otherNation=3&fromYear=190&fromMonth=1&year=190&month=6')
    );
    await expect(page.getByRole('button', { name: '문서 승인', exact: true })).toBeVisible();
    expect(requests.some(({ operation }) => operation === 'playAudit.diplomacyEvent')).toBe(false);
    const count = requests.filter(({ operation }) => operation === 'playAudit.diplomacyHistory').length;
    const nations = requests.filter(({ operation }) => operation === 'playAudit.nations').length;
    await page.getByRole('button', { name: '문서 승인', exact: true }).click();
    await expect(
        page.getByRole('region', { name: '당시 외교 문서' }).getByText('서명된 내용', { exact: true })
    ).toBeVisible();
    expect(requests.filter(({ operation }) => operation === 'playAudit.diplomacyHistory')).toHaveLength(count);
    expect(requests.filter(({ operation }) => operation === 'playAudit.nations')).toHaveLength(nations);
    await page.getByText('원문 HTML 확인', { exact: true }).click();
    await expect(page.locator('pre').filter({ hasText: '<script>window.auditInjected=true</script>' })).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, 'auditInjected'))).toBeUndefined();
    await capture(page, 'desktop-diplomacy-detail');
    await page.reload();
    await expect(page.getByRole('heading', { name: '문서 #8' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, 'mobile-diplomacy-detail');
    const comparison = page.getByLabel('외교 전후 값', { exact: true });
    await comparison.hover();
    await page.mouse.wheel(650, 0);
    await expect.poll(() => comparison.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await page.getByRole('button', { name: '외교 상세 닫기' }).click();
    await page.getByRole('button', { name: '다음 사건 50개' }).click();
    await page.getByRole('button', { name: '문서 파기', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('해시와 달라');
    await expect(page.getByRole('region', { name: '당시 외교 문서' })).toHaveCount(0);
    const before = requests.filter(({ operation }) => operation === 'playAudit.diplomacyHistory').length;
    await page.getByLabel('시작 월', { exact: true }).fill('2');
    expect(requests.filter(({ operation }) => operation === 'playAudit.diplomacyHistory')).toHaveLength(before);
    await page.getByRole('button', { name: '조회', exact: true }).click();
    await expect
        .poll(() => requests.filter(({ operation }) => operation === 'playAudit.diplomacyHistory').length)
        .toBeGreaterThan(before);
    expect(requests.filter(({ operation }) => operation === 'playAudit.diplomacyHistory').at(-1)?.input.from).toEqual({
        year: 190,
        month: 2,
    });
});

test('diplomacy detail failure retries independently', async ({ page }) => {
    const requests = await install(page);
    let fail = true;
    await page.route(gameTrpcRoute, async (route) => {
        if (fail && route.request().url().includes('playAudit.diplomacyEvent')) {
            fail = false;
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify([
                    {
                        error: {
                            message: '외교 상세 재시도',
                            code: -32603,
                            data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
                        },
                    },
                ]),
            });
        } else await route.fallback();
    });
    await page.goto(
        gamePath('/play-audit?tab=diplomacy&nation=2&otherNation=3&fromYear=190&fromMonth=1&year=190&month=6')
    );
    await expect(page.getByRole('button', { name: '문서 승인', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '문서 승인', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('외교 상세 재시도');
    const count = requests.filter(({ operation }) => operation === 'playAudit.diplomacyHistory').length;
    await page.getByRole('button', { name: '상세 다시 조회' }).click();
    await expect(page.getByRole('heading', { name: '문서 #8' })).toBeVisible();
    expect(requests.filter(({ operation }) => operation === 'playAudit.diplomacyHistory')).toHaveLength(count);
});

test('diplomacy baseline displays observed state without a fictional document or actor', async ({ page }) => {
    const requests = await install(page, false, true);
    await page.goto(
        gamePath('/play-audit?tab=diplomacy&nation=2&otherNation=3&fromYear=190&fromMonth=1&year=190&month=6')
    );
    await page.getByRole('button', { name: '관계 최초 관측', exact: true }).click();
    await expect(page.getByLabel('외교 전후 값', { exact: true })).toContainText('교역');
    await expect(page.getByLabel('외교 전후 값', { exact: true })).toContainText('미관측 / 없음');
    await expect(page.getByRole('region', { name: '당시 외교 문서' })).toHaveCount(0);
    expect(requests.filter(({ operation }) => operation === 'playAudit.diplomacyHistory')).toHaveLength(1);
});

test('existing diplomacy document is an initial observation with its preserved source', async ({ page }) => {
    await install(page, false, 'document');
    await page.goto(
        gamePath('/play-audit?tab=diplomacy&nation=2&otherNation=3&fromYear=190&fromMonth=1&year=190&month=6')
    );
    await page.getByRole('button', { name: '문서 최초 관측', exact: true }).click();
    await expect(page.getByLabel('외교 전후 값', { exact: true })).toContainText('미관측 / 없음');
    await expect(page.getByRole('region', { name: '당시 외교 문서' })).toContainText('도입 전 본문');
    await expect(page.getByRole('heading', { name: '문서 #8' })).toBeVisible();
});

for (const [kind, label, value] of [
    ['created', '신생국 관계 생성', '교역'],
    ['removed', '멸망국 관계 종료', '불가침'],
] as const) {
    test(`nation relation lifecycle displays ${kind} with a missing side`, async ({ page }) => {
        await install(page, false, kind);
        await page.goto(
            gamePath('/play-audit?tab=diplomacy&nation=2&otherNation=3&fromYear=190&fromMonth=1&year=190&month=6')
        );
        await page.getByRole('button', { name: label, exact: true }).click();
        await expect(page.getByLabel('외교 전후 값', { exact: true })).toContainText(value);
        await expect(page.getByLabel('외교 전후 값', { exact: true })).toContainText('미관측 / 없음');
    });
}

test('general search is explicit and persists across pagination and reload', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requests = await install(page);
    await page.goto(gamePath('/play-audit?tab=generals&at=month&year=190&month=6'));
    await expect(page.getByRole('rowheader', { name: /감사장수/ })).toBeVisible();
    const count = requests.filter((r) => r.operation === 'playAudit.generals').length;
    await page.getByLabel('장수 이름', { exact: true }).fill('감사');
    await page.getByLabel('장수 번호 정렬', { exact: true }).selectOption('desc');
    expect(requests.filter((r) => r.operation === 'playAudit.generals')).toHaveLength(count);
    await page.getByRole('button', { name: '조회', exact: true }).click();
    await expect(page).toHaveURL(/name=/);
    await expect
        .poll(() => requests.filter((r) => r.operation === 'playAudit.generals').at(-1)?.input)
        .toMatchObject({
            name: '감사',
            order: 'desc',
            at: { year: 190, month: 6, kind: 'MONTH_END' },
        });
    await page.getByRole('button', { name: '다음 50개 불러오기' }).click();
    await expect
        .poll(() => requests.filter((r) => r.operation === 'playAudit.generals').at(-1)?.input)
        .toMatchObject({
            name: '감사',
            order: 'desc',
            cursor: 1,
        });
    await page.reload();
    await expect(page.getByLabel('장수 이름', { exact: true })).toHaveValue('감사');
    await expect(page.getByLabel('장수 번호 정렬', { exact: true })).toHaveValue('desc');
    await expect(page.getByRole('rowheader', { name: /감사장수/ })).toBeVisible();
    await capture(page, 'mobile-general-search');
});

test('NPC decisions are explicit, paginated, independently addressable and escaped', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requests = await install(page);
    await page.goto(gamePath('/play-audit?tab=generals&at=month&year=190&month=6&general=1'));
    await expect(page.getByRole('heading', { name: '선택 장수 상세' })).toBeVisible();
    expect(requests.some((r) => r.operation.startsWith('playAudit.decision'))).toBe(false);
    await page.getByRole('button', { name: 'NPC 결정 기록 조회', exact: true }).click();
    await expect(page.getByRole('button', { name: '개인 판단 · tick 100', exact: true })).toBeVisible();
    expect(requests.filter((r) => r.operation === 'playAudit.decisionHistory').at(-1)?.input).toMatchObject({
        generalId: 1,
        month: { year: 190, month: 6 },
    });
    expect(requests.some((r) => r.operation === 'playAudit.decisionDetail')).toBe(false);
    const counts = {
        list: requests.filter((r) => r.operation === 'playAudit.generals').length,
        history: requests.filter((r) => r.operation === 'playAudit.decisionHistory').length,
    };
    await page.getByRole('button', { name: '개인 판단 · tick 100', exact: true }).click();
    await expect(page.getByRole('list', { name: '판단 절차' })).toContainText('<b>징병판정</b>');
    await expect(page.getByRole('list', { name: '판단 절차' }).locator('b')).toHaveCount(0);
    await page.getByRole('button', { name: '판단 절차 더 불러오기', exact: true }).click();
    await expect(page.getByRole('list', { name: '판단 절차' })).toContainText('실행 시도 1');
    await expect(page.getByRole('list', { name: '판단 절차' })).toContainText(
        '조건 · che_징병 · 차단 · <b>자원 부족</b>'
    );
    await expect(page.getByRole('list', { name: '판단 절차' }).locator('b')).toHaveCount(0);
    await expect(page.getByRole('list', { name: '판단 절차' }).locator(':scope > li').last()).toHaveAttribute(
        'value',
        '129'
    );
    expect(requests.filter((r) => r.operation === 'playAudit.decisionDetail').at(-1)?.input).toMatchObject({
        id: decision.id,
        generalId: 1,
        cursor: 0,
        limit: 1,
    });
    expect(requests.filter((r) => r.operation === 'playAudit.generals')).toHaveLength(counts.list);
    expect(requests.filter((r) => r.operation === 'playAudit.decisionHistory')).toHaveLength(counts.history);
    await capture(page, 'mobile-npc-decision');
    await page.reload();
    await expect(page.getByRole('list', { name: '판단 절차' })).toContainText('징병판정');
    await page.getByRole('button', { name: '결정 목록 더 불러오기', exact: true }).click();
    await expect(page.getByRole('button', { name: '수뇌 판단 · tick 100', exact: true })).toBeVisible();
});

test('NPC decision detail retry preserves history and other general information', async ({ page }) => {
    const requests = await install(page);
    let fail = true;
    await page.route(gameTrpcRoute, async (route) => {
        if (fail && route.request().url().includes('playAudit.decisionDetail')) {
            fail = false;
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify([
                    {
                        error: {
                            message: '결정 상세 재시도',
                            code: -32603,
                            data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
                        },
                    },
                ]),
            });
        } else await route.fallback();
    });
    await page.goto(gamePath('/play-audit?tab=generals&general=1'));
    await page.getByRole('button', { name: 'NPC 결정 기록 조회', exact: true }).click();
    await page.getByRole('button', { name: '개인 판단 · tick 100', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('결정 상세 재시도');
    await expect(page.getByRole('button', { name: '개인 판단 · tick 100', exact: true })).toBeVisible();
    const count = requests.filter((r) => r.operation === 'playAudit.decisionHistory').length;
    await page.getByRole('button', { name: '결정 상세 다시 조회', exact: true }).click();
    await expect(page.getByRole('list', { name: '판단 절차' })).toContainText('징병판정');
    expect(requests.filter((r) => r.operation === 'playAudit.decisionHistory')).toHaveLength(count);
    await capture(page, 'desktop-npc-decision');
});

test('NPC decision opens its immutable policy without querying policy history', async ({ page }) => {
    const requests = await install(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(gamePath(`/play-audit?tab=generals&general=1&decision=${decision.id}`));
    await expect(page.getByRole('list', { name: '판단 절차' })).toBeVisible();
    expect(requests.some((r) => r.operation === 'playAudit.policyVersion')).toBe(false);
    const before = requests.length;
    await page.getByText('당시 정책 참조', { exact: true }).click();
    await page.getByRole('button', { name: '국방 설정 당시 버전 조회', exact: true }).click();
    await expect(page.getByText(/국가 #2 · 버전 1/)).toBeVisible();
    expect(requests.slice(before).map((r) => r.operation)).toEqual(['playAudit.policyVersion']);
    expect(requests.at(-1)?.input).toEqual({ id: 'a'.repeat(64) });
    await expect(page.getByRole('button', { name: '이전 정책 버전', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => Object.hasOwn(window, 'auditInjected'))).toBe(false);
    await capture(page, 'mobile-decision-policy');
    await page.reload();
    await expect(page.getByText(/국가 #2 · 버전 1/)).toBeVisible();
    expect(requests.some((r) => r.operation === 'playAudit.policyHistory')).toBe(false);
    await page.getByRole('button', { name: '정책 상세 닫기', exact: true }).click();
    await expect(page.getByRole('heading', { name: /선택 정책 버전/ })).toHaveCount(0);
    const policyReads = requests.filter((r) => r.operation === 'playAudit.policyVersion').length;
    await page.goto(gamePath(`/play-audit?tab=generals&general=1&decision=${decision.id}&policy=${'b'.repeat(64)}`));
    await expect(page.getByRole('list', { name: '판단 절차' })).toBeVisible();
    expect(requests.filter((r) => r.operation === 'playAudit.policyVersion')).toHaveLength(policyReads);
    await expect(page.getByRole('heading', { name: /선택 정책 버전/ })).toHaveCount(0);
});

for (const [status, label] of [
    ['PREPARING', '준비 중'],
    ['BLOCKED', '실행 차단'],
] as const) {
    test(`NPC execution ${status} is distinguished from a failed execution`, async ({ page }) => {
        await install(page, false, false, status);
        await page.goto(gamePath(`/play-audit?tab=generals&general=1&decision=${decision.id}`));
        const region = page.getByRole('region', { name: 'NPC 결정 기록', exact: true });
        await expect(region.getByRole('table')).toContainText(label);
        await expect(region.getByRole('region', { name: '선택 결정 상세', exact: true })).toContainText(label);
        await expect(region).not.toContainText('실행 실패');
    });
}

test('policy request state is explicit, retries independently and resets on version change', async ({ page }) => {
    const requests = await install(page);
    let fail = true;
    await page.route(gameTrpcRoute, async (route) => {
        if (fail && route.request().url().includes('playAudit.requestState')) {
            fail = false;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    {
                        error: {
                            message: '요청 조회 일시 오류',
                            code: -32603,
                            data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
                        },
                    },
                ]),
            });
        } else await route.fallback();
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
        gamePath('/play-audit?tab=policies&nation=2&policyArea=DEFENCE&fromYear=190&fromMonth=1&year=190&month=6')
    );
    await page.getByRole('button', { name: '버전 2', exact: true }).click();
    await expect(page.getByRole('button', { name: '요청 처리 조회', exact: true })).toBeVisible();
    expect(requests.some((r) => r.operation === 'playAudit.requestState')).toBe(false);
    const before = requests.length;
    await page.getByRole('button', { name: '요청 처리 조회', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('요청 조회 일시 오류');
    await page.getByRole('button', { name: '요청 처리 다시 조회', exact: true }).click();
    const region = page.getByRole('region', { name: '요청 처리 기록', exact: true });
    await expect(region).toContainText('9007199254740993');
    await expect(region).toContainText('처리 성공');
    await expect(region).toContainText('시도별 전체 이력이나 실제 변경 횟수는 아닙니다');
    expect(requests.slice(before).map((r) => r.operation)).toEqual(['playAudit.requestState']);
    expect(requests.at(-1)?.input).toEqual({ kind: 'POLICY', id: 'b'.repeat(64) });
    await capture(page, 'mobile-policy-request');
    const count = requests.filter((r) => r.operation === 'playAudit.requestState').length;
    await page.getByRole('button', { name: '이전 정책 버전', exact: true }).click();
    await expect(region).not.toContainText('9007199254740993');
    expect(requests.filter((r) => r.operation === 'playAudit.requestState')).toHaveLength(count);
    await page.getByRole('button', { name: '요청 처리 조회', exact: true }).click();
    await expect(region).toContainText('연결된 요청이 없습니다');
});

test('diplomacy request state does not reload documents or lists', async ({ page }) => {
    const requests = await install(page);
    await page.goto(
        gamePath('/play-audit?tab=diplomacy&nation=2&otherNation=3&fromYear=190&fromMonth=1&year=190&month=6')
    );
    await page.getByRole('button', { name: '문서 승인', exact: true }).click();
    await expect(page.getByRole('button', { name: '요청 처리 조회', exact: true })).toBeVisible();
    const before = requests.length;
    await page.getByRole('button', { name: '요청 처리 조회', exact: true }).click();
    await expect(page.getByRole('region', { name: '요청 처리 기록', exact: true })).toContainText('처리 성공');
    expect(requests.slice(before).map((r) => r.operation)).toEqual(['playAudit.requestState']);
    expect(requests.at(-1)?.input.kind).toBe('DIPLOMACY');
    await capture(page, 'desktop-diplomacy-request');
});
