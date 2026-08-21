import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';
import { expectLumenButtonStates } from './lumenButton.js';

const basePath = `/${(process.env.PLAYWRIGHT_GAME_BASE_PATH ?? 'che').replace(/^\/+|\/+$/g, '')}`;
const artifactRoot = process.env.DIPLOMACY_ARTIFACT_DIR ? resolve(process.env.DIPLOMACY_ARTIFACT_DIR) : null;
const response = (data: unknown) => ({ result: { data } });
const operationName = (route: Route): string => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6));
};

const installFixture = async (page: Page, permission: number) => {
    await page.addInitScript(
        (profile) => {
            localStorage.setItem('sammo-game-token', 'ga_diplomacy_html_playwright');
            localStorage.setItem('sammo-game-profile', profile);
            delete (globalThis as Record<string, unknown>).__diplomacyXss;
        },
        `${basePath.slice(1)}:default`
    );
    await page.route(`**${basePath}/api/trpc/**`, async (route) => {
        const results = operationName(route)
            .split(',')
            .map((operation) => {
                if (operation === 'auth.status') return response({ ok: true });
                if (operation === 'lobby.info') return response({ myGeneral: { id: 1, name: '정화외교관' } });
                if (operation === 'join.getConfig') return response({});
                if (operation === 'diplomacy.getLetters') {
                    return response({
                        myNationId: 1,
                        permission,
                        nations: [{ id: 2, name: '상대국', color: '#ff0000', level: 5 }],
                        letters: [
                            {
                                id: 7,
                                src: {
                                    nationId: 1,
                                    nationName: '정화국',
                                    nationColor: '#00ffff',
                                    generalId: 1,
                                    generalName: '정화외교관',
                                    generalIcon: null,
                                },
                                dest: {
                                    nationId: 2,
                                    nationName: '상대국',
                                    nationColor: '#ff0000',
                                    generalId: null,
                                    generalName: null,
                                    generalIcon: null,
                                },
                                prevId: null,
                                state: 'PROPOSED',
                                stateOpt: null,
                                brief: '<p><strong>서버 정화 공개문</strong></p><img src="/image/icons/default.jpg" alt="문서" />',
                                detail:
                                    permission >= 3
                                        ? '<ul><li>서버 정화 기밀문</li></ul><a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">자료</a>'
                                        : '(권한이 부족합니다)',
                                date: '2026-07-31T00:00:00.000Z',
                                reason: { who: null, action: null, text: null },
                            },
                        ],
                    });
                }
                throw new Error(`Unhandled diplomacy fixture operation: ${operation}`);
            });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
    await page.route('**/image/icons/default.jpg', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                'base64'
            ),
        });
    });
};

const screenshot = async (page: Page, name: string) => {
    if (!artifactRoot) return;
    await mkdir(artifactRoot, { recursive: true });
    await page.screenshot({ path: resolve(artifactRoot, name), fullPage: true });
};

for (const viewport of [
    { name: 'desktop', width: 1200, height: 900 },
    { name: 'mobile', width: 500, height: 900 },
] as const) {
    test(`renders only server-purified diplomacy HTML on ${viewport.name}`, async ({ page }) => {
        await installFixture(page, 4);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('diplomacy');

        const card = page.locator('.letter-card');
        await expect(card).toBeVisible();
        await expect(card.locator('strong')).toHaveText('서버 정화 공개문');
        await expect(card.locator('li')).toHaveText('서버 정화 기밀문');
        await expect(card.getByRole('link', { name: '자료' })).toHaveAttribute('href', 'https://example.com');
        await expect(card.getByRole('link', { name: '자료' })).toHaveAttribute('rel', 'noopener noreferrer nofollow');
        await expect(card.locator('.letter-text script, .letter-text svg, .letter-text math')).toHaveCount(0);
        await expect(card.locator('.letter-text [onerror], .letter-text [onclick], .letter-text [style]')).toHaveCount(
            0
        );
        expect(await page.evaluate(() => (globalThis as Record<string, unknown>).__diplomacyXss)).toBeUndefined();

        const geometry = await card.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const text = element.querySelector<HTMLElement>('.letter-text')!;
            const textRect = text.getBoundingClientRect();
            const style = getComputedStyle(text);
            return {
                card: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                documentWidth: document.documentElement.scrollWidth,
                labelWidth: element.querySelector<HTMLElement>('.row-label')?.getBoundingClientRect().width,
                headerFontSize: getComputedStyle(element.querySelector('h3')!).fontSize,
                text: {
                    x: textRect.x,
                    y: textRect.y,
                    width: textRect.width,
                    fontFamily: style.fontFamily,
                    fontSize: style.fontSize,
                    lineHeight: style.lineHeight,
                },
            };
        });
        expect(geometry.card.width).toBe(1000);
        expect(geometry.documentWidth).toBe(viewport.name === 'mobile' ? 1000 : viewport.width);
        expect(geometry.labelWidth).toBe(200);
        expect(geometry.headerFontSize).toBe('28px');
        expect(geometry.text.width).toBe(800);

        if (artifactRoot) {
            await mkdir(artifactRoot, { recursive: true });
            await writeFile(
                resolve(artifactRoot, `diplomacy-html-${basePath.slice(1)}-${viewport.name}.json`),
                `${JSON.stringify({ basePath, viewport, geometry }, null, 2)}\n`,
                'utf8'
            );
        }

        const send = page.getByRole('button', { name: '전송' });
        await expectLumenButtonStates(page, send, 'rgb(55, 90, 127)');
        await screenshot(page, `diplomacy-html-${basePath.slice(1)}-${viewport.name}.png`);
    });
}

test('keeps diplomacy detail redacted below permission three', async ({ page }) => {
    await installFixture(page, 2);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('diplomacy');

    const card = page.locator('.letter-card');
    await expect(card).toContainText('(권한이 부족합니다)');
    await expect(card).not.toContainText('서버 정화 기밀문');
    await expect(page.getByText('문서 작성 권한은 군주/수뇌에게만 제공됩니다.')).toBeVisible();
    await expect(page.getByRole('button', { name: '전송' })).toHaveCount(0);
});
