import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createGamePostgresConnector } from '../../../packages/infra/dist/index.js';

const bootstrapFile = process.env.COMMAND_PANEL_LIVE_BOOTSTRAP_FILE;
const databaseUrl = process.env.DATABASE_URL;
const gatewayUrl = process.env.COMMAND_PANEL_LIVE_GATEWAY_URL ?? 'http://127.0.0.1:13013/trpc';
const profile = process.env.COMMAND_PANEL_LIVE_PROFILE ?? 'hwe:2601';
const enabled = Boolean(bootstrapFile && databaseUrl);

type Bootstrap = { sessionToken: string; user: { id: string } };

const installSession = async (page: Page): Promise<Bootstrap> => {
    const bootstrap = JSON.parse(await readFile(bootstrapFile!, 'utf8')) as Bootstrap;
    const response = await fetch(`${gatewayUrl}/auth.issueGameSession`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-session-token': bootstrap.sessionToken },
        body: JSON.stringify({ sessionToken: bootstrap.sessionToken, profile }),
    });
    const payload = (await response.json()) as { result?: { data?: { gameToken?: string } } };
    const gameToken = payload.result?.data?.gameToken;
    if (!response.ok || !gameToken) throw new Error(`Game session issue failed: HTTP ${response.status}`);
    await page.addInitScript(
        ({ token, gameProfile }) => {
            localStorage.setItem('sammo-game-token', token);
            localStorage.setItem('sammo-game-profile', gameProfile);
        },
        { token: gameToken, gameProfile: profile }
    );
    return bootstrap;
};

const chooseFirstNonEmpty = async (select: Locator): Promise<string> => {
    const value = await select.locator('option').evaluateAll((options) => {
        const match =
            options.find((option) => Number((option as HTMLOptionElement).value) > 0) ??
            options.find((option) => (option as HTMLOptionElement).value !== '');
        return (match as HTMLOptionElement | undefined)?.value ?? '';
    });
    if (!value) throw new Error('The command argument has no selectable value.');
    await select.selectOption(value);
    return value;
};

test('reserves every requested general and chief command through Chromium and restores the snapshot', async ({
    page,
}, testInfo) => {
    test.skip(!enabled, 'requires the isolated scenario 2601 snapshot and bootstrap session');
    const bootstrap = await installSession(page);
    const connector = createGamePostgresConnector({ url: databaseUrl! });
    await connector.connect();
    const db = connector.prisma;
    const general = await db.general.findFirstOrThrow({ where: { userId: bootstrap.user.id } });
    if (!general.nationId || general.officerLevel < 5) throw new Error('The snapshot actor must be a chief.');

    const originalGeneralTurns = await db.generalTurn.findMany({ where: { generalId: general.id } });
    const originalGeneralRevision = await db.generalTurnRevision.findUnique({ where: { generalId: general.id } });
    const originalNationTurns = await db.nationTurn.findMany({
        where: { nationId: general.nationId, officerLevel: general.officerLevel },
    });
    const originalNationRevision = await db.nationTurnRevision.findUnique({
        where: { nationId_officerLevel: { nationId: general.nationId, officerLevel: general.officerLevel } },
    });

    const reserve = async (
        editor: Locator,
        turn: number,
        category: string,
        command: RegExp,
        fill?: (form: Locator) => Promise<void>
    ) => {
        await editor.getByRole('button', { name: `${turn + 1}턴 명령 입력`, exact: true }).click();
        const picker = editor.getByTestId('command-picker');
        await picker.getByRole('button', { name: new RegExp(`^(?:국가:)?${category}$`) }).click();
        const commandButton = picker.getByRole('button', { name: command }).first();
        await expect(commandButton).toBeEnabled();
        await commandButton.click();
        if (fill) {
            const form = picker.getByTestId('command-argument-form');
            await fill(form);
            await picker.getByRole('button', { name: '입력', exact: true }).click();
        }
        await expect(editor.locator('.action-column > div').nth(turn)).toHaveText(command);
    };

    try {
        await page.goto('./');
        const generalEditor = page.locator('[data-command-scope="general"]');
        await expect(generalEditor).toBeVisible();
        await reserve(generalEditor, 0, '전략', /^임관$/, async (form) => {
            await chooseFirstNonEmpty(form.locator('select'));
        });
        await reserve(generalEditor, 1, '전략', /(랜덤|무작위).*임관/);
        await reserve(generalEditor, 2, '내정', /^징병$/, async (form) => {
            await chooseFirstNonEmpty(form.locator('select'));
            await form.locator('input[type=number]').fill('1');
        });
        await reserve(generalEditor, 3, '군사', /^출병$/, async (form) => {
            await chooseFirstNonEmpty(form.locator('select'));
        });
        await reserve(generalEditor, 4, '내정', /농지 ?개간/);
        await reserve(generalEditor, 5, '계략', /^화계$/, async (form) => {
            await chooseFirstNonEmpty(form.locator('select'));
        });
        await reserve(generalEditor, 6, '국가', /^증여$/, async (form) => {
            await form.getByRole('button', { name: '쌀', exact: true }).click();
            await form.locator('input[type=number]').fill('1');
            await chooseFirstNonEmpty(form.locator('select'));
        });
        await reserve(generalEditor, 7, '개인', /장비 ?매매/, async (form) => {
            await form.locator('#command-arg-itemType').selectOption('item');
            const item = form.locator('#command-arg-itemCode');
            const pillValue = await item.locator('option').filter({ hasText: '환약' }).first().getAttribute('value');
            if (!pillValue) throw new Error('환약 is missing from the item command options.');
            await item.selectOption(pillValue);
        });
        await page.screenshot({ path: testInfo.outputPath('general-requested-commands.png'), fullPage: true });

        await page.locator('[data-navigation-id="chief-center"]').click();
        await expect(page).toHaveURL(/\/chief-center$/);
        const nationEditor = page.locator('[data-command-scope="nation"]');
        await expect(nationEditor).toBeVisible();
        await reserve(nationEditor, 0, '인사', /^포상$/, async (form) => {
            await form.getByRole('button', { name: '쌀', exact: true }).click();
            await form.locator('input[type=number]').fill('1');
            await chooseFirstNonEmpty(form.locator('select'));
        });
        await reserve(nationEditor, 1, '인사', /^발령$/, async (form) => {
            await chooseFirstNonEmpty(form.locator('select').nth(0));
            await chooseFirstNonEmpty(form.locator('select').nth(1));
        });
        await reserve(nationEditor, 2, '특수', /^증축$/);
        await reserve(nationEditor, 3, '전략', /^필사즉생$/);

        const generalRows = await db.generalTurn.findMany({
            where: { generalId: general.id, turnIdx: { in: [0, 1, 2, 3, 4, 5, 6, 7] } },
            orderBy: { turnIdx: 'asc' },
        });
        expect(generalRows.map((row: { actionCode: string }) => row.actionCode)).toEqual([
            'che_임관',
            'che_랜덤임관',
            'che_징병',
            'che_출병',
            'che_농지개간',
            'che_화계',
            'che_증여',
            'che_장비매매',
        ]);
        expect(generalRows[7]?.arg).toMatchObject({ itemType: 'item' });
        const nationRows = await db.nationTurn.findMany({
            where: {
                nationId: general.nationId,
                officerLevel: general.officerLevel,
                turnIdx: { in: [0, 1, 2, 3] },
            },
            orderBy: { turnIdx: 'asc' },
        });
        expect(nationRows.map((row: { actionCode: string }) => row.actionCode)).toEqual([
            'che_포상',
            'che_발령',
            'che_증축',
            'che_필사즉생',
        ]);
        await page.screenshot({ path: testInfo.outputPath('chief-requested-commands.png'), fullPage: true });
    } finally {
        await db.$transaction(async (transaction) => {
            await transaction.generalTurn.deleteMany({ where: { generalId: general.id } });
            if (originalGeneralTurns.length) await transaction.generalTurn.createMany({ data: originalGeneralTurns });
            await transaction.generalTurnRevision.deleteMany({ where: { generalId: general.id } });
            if (originalGeneralRevision)
                await transaction.generalTurnRevision.create({ data: originalGeneralRevision });
            await transaction.nationTurn.deleteMany({
                where: { nationId: general.nationId, officerLevel: general.officerLevel },
            });
            if (originalNationTurns.length) await transaction.nationTurn.createMany({ data: originalNationTurns });
            await transaction.nationTurnRevision.deleteMany({
                where: { nationId: general.nationId, officerLevel: general.officerLevel },
            });
            if (originalNationRevision) await transaction.nationTurnRevision.create({ data: originalNationRevision });
        });
        await connector.disconnect();
    }
});
