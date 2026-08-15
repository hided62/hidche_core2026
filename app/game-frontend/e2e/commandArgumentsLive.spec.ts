import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter as GatewayAppRouter } from '@sammo-ts/gateway-api';
import type { AppRouter as GameAppRouter } from '@sammo-ts/game-api';
import { expect, test } from '@playwright/test';
import { constants, publicEncrypt } from 'node:crypto';

const gatewayUrl = process.env.COMMAND_LIVE_GATEWAY_URL ?? 'http://127.0.0.1:13160/trpc';
const gameUrl = process.env.COMMAND_LIVE_GAME_URL ?? 'http://127.0.0.1:14160/trpc';
type PlainTurn = { index: number; action: string; args: Record<string, unknown> };

test('reserves an argument command in the real game API and reads it back from PostgreSQL', async ({
    page,
}, testInfo) => {
    test.skip(process.env.COMMAND_LIVE !== '1', 'requires the isolated live gateway/game API fixture');
    test.setTimeout(60_000);
    const gateway = createTRPCProxyClient<GatewayAppRouter>({
        links: [httpBatchLink({ url: gatewayUrl })],
    });
    const passwordKey = await gateway.auth.passwordKey.query();
    const login = await gateway.auth.login.mutate({
        username: 'demo2',
        credential: {
            keyId: passwordKey.keyId,
            ciphertext: publicEncrypt(
                {
                    key: passwordKey.publicKeyPem,
                    padding: constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: 'sha256',
                },
                Buffer.from('demo-pass-2', 'utf8')
            ).toString('base64'),
        },
    });
    if (login.status !== 'login') {
        throw new Error('Local live fixture unexpectedly requires Kakao OTP.');
    }
    const issued = await gateway.auth.issueGameSession.mutate({
        sessionToken: login.sessionToken,
        profile: 'che:2',
    });
    let accessToken = '';
    const game = createTRPCProxyClient<GameAppRouter>({
        links: [
            httpBatchLink({
                url: gameUrl,
                headers: () => ({ authorization: `Bearer ${accessToken}` }),
            }),
        ],
    });
    accessToken = (await game.auth.exchangeGatewayToken.mutate({ gatewayToken: issued.gameToken })).accessToken;
    const context = await game.general.me.query();
    if (!context) throw new Error('demo2 general is missing');
    if (!context.nation) throw new Error('demo2 nation is missing');
    const nationName = context.nation.name;
    const generalId = context.general.id;
    const originalGeneralSnapshot = await game.turns.reserved.getGeneral.query({ generalId });
    const original = (originalGeneralSnapshot.turns as unknown as PlainTurn[])[29];
    const originalNationSnapshot = await game.turns.reserved.getNation.query({ generalId });
    const originalNation = (originalNationSnapshot.turns as unknown as PlainTurn[])[11];

    await page.addInitScript(
        ({ token }) => {
            localStorage.setItem('sammo-game-token', token);
            localStorage.setItem('sammo-game-profile', 'che:2');
        },
        { token: accessToken }
    );

    try {
        await page.goto('/');
        await expect(page.getByRole('heading', { name: '전장 현황' })).toBeVisible();
        const generalSection = page.locator('.reserved-section').filter({ hasText: '일반 예턴' });
        const lastTurn = generalSection.locator('.reserved-item').nth(29);
        const form = page.getByTestId('command-argument-form');
        for (const strategy of [
            { key: 'che_선동', name: '선동' },
            { key: 'che_탈취', name: '탈취' },
            { key: 'che_파괴', name: '파괴' },
            { key: 'che_화계', name: '화계' },
        ]) {
            await page.getByRole('button', { name: '계략', exact: true }).click();
            await page.getByRole('button', { name: new RegExp(strategy.name) }).click();
            await expect(form).toBeVisible();
            const citySelect = form.locator('select');
            const optionValues = await citySelect
                .locator('option')
                .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
            const targetCityId = Number(optionValues.find((value) => Number(value) !== context.general.cityId));
            expect(targetCityId).toBeGreaterThan(0);
            await citySelect.selectOption(String(targetCityId));

            await lastTurn.getByRole('button', { name: '배치' }).click();
            await expect(lastTurn.locator('.turn-action')).toHaveText(strategy.key);

            const persisted = (await game.turns.reserved.getGeneral.query({ generalId })).turns[29];
            expect(persisted).toEqual({
                index: 29,
                action: strategy.key,
                args: { destCityId: targetCityId },
            });
        }

        await page.getByRole('button', { name: '국가:인사', exact: true }).click();
        await page.getByRole('button', { name: /포상/ }).click();
        await form.getByRole('button', { name: '쌀', exact: true }).click();
        await form.locator('input[type=number]').fill('1');
        const generalSelect = form.locator('select');
        const generalValues = await generalSelect.locator('option').evaluateAll((options) =>
            options.map((option) => ({
                value: (option as HTMLOptionElement).value,
                label: option.textContent ?? '',
            }))
        );
        const targetGeneralId = Number(
            generalValues.find(
                (option) => Number(option.value) !== generalId && option.label.includes(`(${nationName} ·`)
            )?.value
        );
        expect(targetGeneralId).toBeGreaterThan(0);
        await generalSelect.selectOption(String(targetGeneralId));
        const nationSection = page.locator('.reserved-section').filter({ hasText: '국가 예턴' });
        const lastNationTurn = nationSection.locator('.reserved-item').nth(11);
        await lastNationTurn.getByRole('button', { name: '배치' }).click();
        await expect(lastNationTurn.locator('.turn-action')).toHaveText('che_포상');
        const persistedNation = (await game.turns.reserved.getNation.query({ generalId })).turns[11];
        expect(persistedNation).toEqual({
            index: 11,
            action: 'che_포상',
            args: { isGold: false, amount: 1, destGeneralId: targetGeneralId },
        });
        await page.screenshot({
            path: testInfo.outputPath('real-che-command-reserved.png'),
            fullPage: true,
        });
    } finally {
        const currentGeneral = await game.turns.reserved.getGeneral.query({ generalId });
        await game.turns.reserved.setGeneral.mutate({
            generalId,
            turnIndex: 29,
            action: original?.action ?? '휴식',
            args: original?.args ?? {},
            expectedRevision: currentGeneral.revision,
        });
        const currentNation = await game.turns.reserved.getNation.query({ generalId });
        await game.turns.reserved.setNation.mutate({
            generalId,
            turnIndex: 11,
            action: originalNation?.action ?? '휴식',
            args: originalNation?.args ?? {},
            expectedRevision: currentNation.revision,
        });
    }
});
