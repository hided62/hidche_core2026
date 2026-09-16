import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { canonicalFrontendFixture as fixture } from '../../../tools/frontend-legacy-parity/fixtures/canonical.js';
import { gameBasePath, gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const wall = new Date('2026-09-16T12:00:00Z');
const game = new Date('2026-09-16T11:50:00Z');
type ClockCase = 'normal' | 'recovery' | 'recovery-end' | 'suspended';
const install = async (page: Page, routeName: string, clockCase: ClockCase, displayMode: string) => {
    await page.clock.install({ time: wall });
    await page.clock.setFixedTime(wall);
    await page.addInitScript(
        ({ profile, base, displayMode }) => {
            localStorage.setItem('sammo-game-token', 'ga_deadline_fixture');
            localStorage.setItem('sammo-game-profile', profile);
            localStorage.setItem(`sammo-clock-display:${profile}:${base}/`, displayMode);
        },
        { profile: gameProfile, base: gameBasePath, displayMode }
    );
    const calls: string[] = [];
    let voted = false;
    const endAt = new Date(game.getTime() + 20_000).toISOString();
    await page.route('**/events**', (route) => route.abort());
    await page.route('**/image/**', (route) =>
        route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#888"/></svg>',
        })
    );
    await page.route('**/icons/**', (route) =>
        route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>',
        })
    );
    await page.route(gameTrpcRoute, async (route) => {
        const operations = decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(
            ','
        );
        const results = operations.map((operation) => {
            calls.push(operation);
            let data: unknown = {};
            if (operation === 'auth.status') data = { ok: true };
            if (operation === 'lobby.info')
                data = {
                    ...fixture.game.lobby,
                    myGeneral: routeName === 'join' || routeName === 'select-general' ? null : { id: 1, name: '관우' },
                    serverTime: game.toISOString(),
                    serverWallTime: wall.toISOString(),
                    clockMode: 'realtime',
                    clockRunning: clockCase !== 'suspended',
                    clockRecovery:
                        clockCase === 'recovery' || clockCase === 'recovery-end'
                            ? {
                                  startsAt: wall.toISOString(),
                                  endsAt: new Date(
                                      wall.getTime() + (clockCase === 'recovery' ? 600_000 : 5_000)
                                  ).toISOString(),
                              }
                            : null,
                };
            if (operation === 'general.me') data = { general: { id: 1, name: '관우' } };
            if (operation === 'join.getConfig')
                data = {
                    rules: {
                        stat: { total: 165, min: 15, max: 80, bonusMin: 3, bonusMax: 5 },
                        allowDirectCreation: false,
                        allowCustomName: true,
                    },
                    user: {
                        id: 'user',
                        displayName: '사용자',
                        canCreateGeneral: true,
                        icons: [],
                        preferredPicture: null,
                    },
                    personalities: [{ key: 'Random', name: '???', info: '' }],
                    warSpecials: [],
                    nations: [],
                    serverInfo: {
                        currentYear: 193,
                        currentMonth: 7,
                        tickMinutes: 5,
                        maxGeneral: 500,
                        userGeneralCount: 0,
                        npcGeneralCount: 1,
                    },
                    selectionPool: { enabled: routeName === 'select-general', hasGeneral: false, allowOptions: [] },
                    npcPossession: { enabled: routeName === 'join' },
                };
            if (operation === 'join.getSelectionPool')
                data = {
                    validUntil: endAt,
                    hasGeneral: false,
                    candidates: [
                        {
                            uniqueName: 'candidate',
                            generalName: '관우',
                            leadership: 80,
                            strength: 80,
                            intel: 80,
                            picture: 'default.jpg',
                            imageServer: 0,
                            specialDomesticName: '인덕',
                            dex: [0, 0, 0, 0, 0],
                        },
                    ],
                };
            if (operation === 'join.listPossessCandidates')
                data = {
                    validUntil: endAt,
                    pickMoreFrom: new Date(game.getTime() + 10_000).toISOString(),
                    pickMoreSeconds: 10,
                    tokenNonce: 'nonce',
                    candidates: [
                        {
                            id: 1,
                            name: '관우',
                            nation: { id: 0, name: '재야', color: '#aaaaaa' },
                            stats: { leadership: 80, strength: 80, intelligence: 80 },
                            picture: 'default.jpg',
                            imageServer: 0,
                            personality: { code: 'x', name: '안전', info: '' },
                            specialDomestic: { code: 'x', name: '인덕', info: '' },
                            specialWar: { code: 'x', name: '무쌍', info: '' },
                            keepCount: 3,
                        },
                    ],
                };
            if (operation === 'vote.getVoteList') data = fixture.game.surveyList;
            if (operation === 'vote.getVoteDetail')
                data = {
                    ...fixture.game.surveyDetail,
                    myVote: voted ? [0] : null,
                    voteInfo: { ...fixture.game.surveyDetail.voteInfo, endAt, closedAt: null, multipleOptions: 1 },
                };
            if (operation === 'vote.submitVote') {
                voted = true;
                data = { ok: true };
            }
            if (operation === 'tournament.getAdminStatus') data = { ok: true };
            if (operation === 'tournament.getSnapshot')
                data = { state: null, participants: [], matches: [], betCount: 0 };
            if (operation === 'tournament.getRankings') data = [];
            if (operation === 'tournament.start') data = { ok: true };
            return { result: { data } };
        });
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(
                new URL(route.request().url()).searchParams.get('batch') === '1' ? results : results[0]
            ),
        });
    });
    await page.goto(routeName);
    return calls;
};
const capture = async (page: Page, info: TestInfo, name: string) => {
    await page.evaluate(() => document.fonts.ready);
    await writeFile(
        info.outputPath(`${name}.json`),
        JSON.stringify(
            await page.locator('main').evaluate((el) => ({
                html: el.outerHTML,
                rect: el.getBoundingClientRect().toJSON(),
                fontSize: getComputedStyle(el).fontSize,
            }))
        )
    );
    await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
};
for (const width of [1365, 390]) {
    for (const clockCase of ['normal', 'recovery', 'recovery-end', 'suspended'] as const) {
        for (const routeName of ['survey', 'select-general', 'join']) {
            test(`${routeName} GAME deadline ${clockCase} ${width}px`, async ({ page }, info) => {
                await page.setViewportSize({ width, height: 900 });
                const calls = await install(page, routeName, clockCase, width === 390 ? 'real' : 'game');
                const voteButton = page.getByRole('button', { name: '투표', exact: true });
                const expired = page.locator(routeName === 'join' ? '.npc-token-expired' : '.expired-text');
                const refresh = page.getByRole('button', { name: /다른 장수 보기/ });
                if (routeName === 'survey') await expect(voteButton).toBeVisible();
                else {
                    await expect(page.getByText('까지 유효', { exact: false })).toBeVisible();
                    await expect(expired).toHaveCount(0);
                }
                if (routeName === 'select-general')
                    await page.getByRole('button', { name: '선택하기', exact: true }).click();
                if (routeName === 'join') await expect(refresh).toBeDisabled();
                await capture(page, info, 'open');
                await page.clock.pauseAt(wall);
                await page.clock.setSystemTime(wall);
                const cooldownMs = clockCase === 'recovery' || clockCase === 'recovery-end' ? 5_250 : 10_250;
                await page.clock.runFor(cooldownMs);
                if (routeName === 'join') {
                    if (clockCase === 'suspended') await expect(refresh).toBeDisabled();
                    else {
                        await expect(refresh).toBeEnabled();
                        await refresh.click();
                        await page.clock.runFor(50);
                        await expect
                            .poll(() => calls.filter((call) => call === 'join.listPossessCandidates').length)
                            .toBe(2);
                    }
                }
                const closeMs = clockCase === 'recovery' ? 10_250 : clockCase === 'recovery-end' ? 15_250 : 20_250;
                await page.clock.runFor(closeMs - cooldownMs);
                if (routeName === 'survey') {
                    if (clockCase === 'suspended') await expect(voteButton).toBeVisible();
                    else await expect(voteButton).toHaveCount(0);
                } else if (clockCase === 'suspended') await expect(expired).toHaveCount(0);
                else await expect(expired).toBeVisible();
                await capture(page, info, 'after');
            });
        }
    }
}
test('survey submits during recovery', async ({ page }) => {
    const votes = await install(page, 'survey', 'recovery', 'real');
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: '투표', exact: true }).click();
    await expect.poll(() => votes.includes('vote.submitVote')).toBe(true);
    await expect(page.getByRole('button', { name: '투표', exact: true })).toHaveCount(0);
});
test('admin start uses the server-owned start endpoint', async ({ page }) => {
    const calls = await install(page, 'tournament', 'recovery', 'real');
    await page.getByRole('button', { name: '개최', exact: true }).click();
    await expect.poll(() => calls.includes('tournament.start')).toBe(true);
    expect(calls).not.toContain('tournament.setState');
});
