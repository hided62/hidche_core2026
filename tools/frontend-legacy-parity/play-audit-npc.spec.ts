import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createRedisConnector, resolveRedisConfigFromEnv } from '../../packages/infra/src/index.js';

const root = resolve(import.meta.dirname, '../..');
const token = `ga_${randomUUID()}`;
const profile = 'che:default';
const accessKey = `sammo:game:access:${profile}:${token}`;
const evidencePath = resolve(root, process.env.NPC_AUDIT_OUTPUT ?? 'test-results/npc-audit-lifecycle', 'evidence.json');
let evidence: {
    subjects: Array<{
        generalId: number;
        npcState: number;
        phase: string;
        year: number;
        month: number;
        id: string;
        steps: number;
    }>;
};
const redis = createRedisConnector(resolveRedisConfigFromEnv());
test.beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url || !new URL(url).searchParams.get('schema')?.endsWith('_npc_audit_lifecycle'))
        throw new Error('Dedicated lifecycle DB required');
    evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    await redis.connect();
    await redis.client.set(
        accessKey,
        JSON.stringify({
            version: 1,
            profile,
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            sessionId: randomUUID(),
            user: {
                id: 'npc-audit-reviewer',
                username: 'npc-audit-reviewer',
                displayName: '감사 검증',
                roles: ['admin.playAudit.read:che:default'],
            },
            sanctions: {},
        }),
        { EX: 3600 }
    );
});
test.afterAll(async () => {
    await redis.client.del(accessKey);
    await redis.disconnect();
});
for (const width of [390, 1280]) {
    test(`real NPC chief and general decisions after conquest at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(
            ({ token }) => {
                localStorage.setItem('sammo-game-token', token);
                localStorage.setItem('sammo-game-profile', 'che:default');
            },
            { token }
        );
        for (const subject of evidence.subjects) {
            await page.goto(`play-audit?tab=generals&general=${subject.generalId}&decision=${subject.id}`);
            const panel = page.getByRole('region', { name: 'NPC 결정 기록', exact: true });
            await expect(panel.getByRole('list', { name: '판단 절차' })).toBeVisible();
            await expect(panel).toContainText(`${subject.year}년 ${subject.month}월`);
            await expect(panel.getByRole('list', { name: '판단 절차' })).toContainText('판단 시작');
            const phase = subject.phase === 'nation' ? '수뇌 판단' : '개인 판단';
            await expect(panel.getByRole('button', { name: new RegExp(`^${phase} · tick`) }).first()).toBeVisible();
            await page.evaluate(() => document.fonts.ready);
            const geometry = await panel.evaluate((element) => ({
                rect: element.getBoundingClientRect().toJSON(),
                font: getComputedStyle(element).fontSize,
                buttons: [...element.querySelectorAll('nav button')].map((button) => ({
                    text: button.textContent,
                    rect: button.getBoundingClientRect().toJSON(),
                    disabled: (button as HTMLButtonElement).disabled,
                })),
            }));
            const name = `npc-${subject.npcState}-${subject.phase}`;
            await writeFile(testInfo.outputPath(`${name}.json`), JSON.stringify(geometry, null, 2));
            await panel.screenshot({ path: testInfo.outputPath(`${name}.png`) });
            await panel.getByRole('button', { name: '이전 월', exact: true }).click();
            await expect(panel.getByRole('region', { name: '선택 결정 상세' })).toHaveCount(0);
            await panel.getByRole('button', { name: '최근 결정 조회', exact: true }).click();
            await expect(panel).toContainText('가장 최근 결정이 수집된 월입니다.');
            await page.reload();
            await page.getByRole('button', { name: 'NPC 결정 기록 조회', exact: true }).click();
            await expect(panel).toContainText('가장 최근 결정이 수집된 월입니다.');
        }
    });
}
