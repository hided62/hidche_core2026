import { randomUUID } from 'node:crypto';

import { expect, test, type Browser, type Page } from '@playwright/test';
import { encryptGameSessionToken } from '../../../packages/common/dist/auth/gameToken.js';
import { createGamePostgresConnector } from '../../../packages/infra/dist/index.js';

const databaseUrl = process.env.CHIEF_CENTER_LIVE_DATABASE_URL;
const gameTokenSecret = process.env.CHIEF_CENTER_LIVE_GAME_SECRET;
const profile = process.env.PLAYWRIGHT_GAME_PROFILE ?? 'hwe:1010';
const hasLiveFixture = Boolean(databaseUrl && gameTokenSecret);
const gameSchema = profile.split(':', 1)[0] ?? '';

const resolveGameDatabaseUrl = (): string => {
    const parsed = new URL(databaseUrl!);
    const sourceSchema = parsed.searchParams.get('schema');
    if (!gameSchema || (sourceSchema !== 'public' && sourceSchema !== gameSchema)) {
        throw new Error(`Refusing unexpected chief-center schema: ${sourceSchema ?? '(missing)'}`);
    }
    parsed.searchParams.set('schema', gameSchema);
    return parsed.toString();
};

const installSession = async (page: Page, userId: string, displayName: string): Promise<void> => {
    const now = new Date();
    const token = encryptGameSessionToken(
        {
            version: 1,
            profile,
            issuedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
            sessionId: `chief-center-live-${randomUUID()}`,
            user: {
                id: userId,
                username: userId,
                displayName,
                roles: ['user'],
                canUseGeneralPicture: false,
            },
            sanctions: {},
            identity: {
                kakaoVerified: true,
                canCreateGeneral: true,
                requiresKakaoVerification: false,
                graceEndsAt: null,
            },
        },
        gameTokenSecret!
    );
    await page.addInitScript(
        ({ gameToken, gameProfile }) => {
            localStorage.setItem('sammo-game-token', gameToken);
            localStorage.setItem('sammo-game-profile', gameProfile);
        },
        { gameToken: token, gameProfile: profile }
    );
};

const newPage = async (browser: Browser, userId: string, displayName: string): Promise<Page> => {
    const context = await browser.newContext({
        viewport: { width: 1365, height: 900 },
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        colorScheme: 'dark',
    });
    const page = await context.newPage();
    await installSession(page, userId, displayName);
    return page;
};

test('persists one chief command and exposes it to a normal nation user and another chief', async ({
    browser,
}, testInfo) => {
    test.skip(!hasLiveFixture, 'isolated chief-center PostgreSQL and token secret are required');
    test.setTimeout(90_000);

    const connector = createGamePostgresConnector({ url: resolveGameDatabaseUrl() });
    await connector.connect();
    const db = connector.prisma;
    const editor = await db.general.findFirstOrThrow({ where: { name: 'GUI비교관리자' } });
    const candidates = await db.general.findMany({
        where: { nationId: editor.nationId, userId: null, id: { not: editor.id } },
        orderBy: { id: 'asc' },
        take: 2,
    });
    if (candidates.length !== 2) throw new Error('Two isolated visibility candidates are required.');
    const [viewer, otherChief] = candidates;
    const viewerUserId = `chief-center-viewer-${randomUUID()}`;
    const otherChiefUserId = `chief-center-peer-${randomUUID()}`;
    const originalTurns = await db.nationTurn.findMany({
        where: { nationId: editor.nationId, officerLevel: editor.officerLevel },
        orderBy: { turnIdx: 'asc' },
    });
    const originalRevision = await db.nationTurnRevision.findUnique({
        where: {
            nationId_officerLevel: { nationId: editor.nationId, officerLevel: editor.officerLevel },
        },
    });
    let selectedTargetId: number | undefined;

    try {
        await db.$transaction([
            db.general.update({
                where: { id: viewer.id },
                data: {
                    userId: viewerUserId,
                    officerLevel: 1,
                    npcState: 0,
                    meta: { ...(viewer.meta as Record<string, unknown>), belong: 999 },
                    penalty: {},
                },
            }),
            db.general.update({
                where: { id: otherChief.id },
                data: { userId: otherChiefUserId, officerLevel: 10, npcState: 0, penalty: {} },
            }),
        ]);

        const editorPage = await newPage(browser, editor.userId!, '사령부입력자');
        await editorPage.goto('chief-center');
        await expect(editorPage.getByRole('heading', { name: '사령부', exact: true })).toBeVisible();
        await editorPage.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
        const picker = editorPage.getByTestId('chief-command-picker');
        await expect(picker).toBeVisible();
        await picker.getByRole('button', { name: '인사', exact: true }).click();
        const reward = picker.getByRole('button', { name: /포상/ });
        await expect(reward).toBeEnabled();
        await reward.click();
        const argumentForm = picker.getByTestId('command-argument-form');
        await argumentForm.getByRole('button', { name: '쌀', exact: true }).click();
        await argumentForm.locator('input[type=number]').fill('1');
        const selectableGeneralIds = await argumentForm
            .locator('select option')
            .evaluateAll((options) =>
                options
                    .map((option) => Number((option as HTMLOptionElement).value))
                    .filter((value) => Number.isInteger(value) && value > 0)
            );
        selectedTargetId = selectableGeneralIds.find((generalId) => generalId !== editor.id);
        if (!selectedTargetId) throw new Error('No reward target is available in the live command table.');
        await argumentForm.locator('select').selectOption(String(selectedTargetId));
        await picker.getByRole('button', { name: '입력', exact: true }).click();
        await expect(
            editorPage.getByTestId('chief-command-editor').locator('.editor-turn-row strong').first()
        ).toHaveText('포상');

        const persisted = await db.nationTurn.findUniqueOrThrow({
            where: {
                nationId_officerLevel_turnIdx: {
                    nationId: editor.nationId,
                    officerLevel: editor.officerLevel,
                    turnIdx: 0,
                },
            },
        });
        expect(persisted.actionCode).toBe('che_포상');
        expect(persisted.arg).toEqual({ isGold: false, amount: 1, destGeneralId: selectedTargetId });
        await editorPage.screenshot({ path: testInfo.outputPath('chief-editor-command-entered.png'), fullPage: true });

        const viewerPage = await newPage(browser, viewerUserId, '일반국가원');
        await viewerPage.goto('chief-center');
        await expect(viewerPage.getByRole('heading', { name: '사령부', exact: true })).toBeVisible();
        await expect(viewerPage.getByTestId('chief-command-editor')).toHaveCount(0);
        await expect(viewerPage.locator('.chief-grid-row').first().getByText('포상', { exact: true })).toBeVisible();
        await viewerPage.screenshot({ path: testInfo.outputPath('chief-normal-user-visible.png'), fullPage: true });

        const peerPage = await newPage(browser, otherChiefUserId, '다른수뇌');
        await peerPage.goto('chief-center');
        await expect(peerPage.getByTestId('chief-command-editor')).toBeVisible();
        await expect(peerPage.locator('.chief-grid-row').first().getByText('포상', { exact: true })).toBeVisible();
        await peerPage.screenshot({ path: testInfo.outputPath('chief-peer-visible.png'), fullPage: true });
    } finally {
        await db.$transaction(async (transaction) => {
            await transaction.nationTurn.deleteMany({
                where: { nationId: editor.nationId, officerLevel: editor.officerLevel },
            });
            if (originalTurns.length) await transaction.nationTurn.createMany({ data: originalTurns });
            await transaction.nationTurnRevision.deleteMany({
                where: { nationId: editor.nationId, officerLevel: editor.officerLevel },
            });
            if (originalRevision) await transaction.nationTurnRevision.create({ data: originalRevision });
            await transaction.general.update({
                where: { id: viewer.id },
                data: {
                    userId: viewer.userId,
                    officerLevel: viewer.officerLevel,
                    npcState: viewer.npcState,
                    meta: viewer.meta,
                    penalty: viewer.penalty,
                },
            });
            await transaction.general.update({
                where: { id: otherChief.id },
                data: {
                    userId: otherChief.userId,
                    officerLevel: otherChief.officerLevel,
                    npcState: otherChief.npcState,
                    meta: otherChief.meta,
                    penalty: otherChief.penalty,
                },
            });
        });
        await connector.disconnect();
    }
});
