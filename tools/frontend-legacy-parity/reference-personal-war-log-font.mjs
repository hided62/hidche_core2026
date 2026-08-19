import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

const refRoot = resolve(process.env.REF_SAM_ROOT ?? '/home/letrhee/sam_rebuild/ref/sam');
const artifactDir = process.env.REF_PERSONAL_WAR_LOG_ARTIFACT_DIR;
const formatterUrl = pathToFileURL(resolve(refRoot, 'hwe/ts/utilGame/formatLog.ts')).href;
const { formatLog } = await import(formatterUrl);
const css = await readFile(resolve(refRoot, 'dist_js/hwe_dynamic/vue/v_main.css'), 'utf8');
const records = [
    '<C>●</>10월:천귀병으로 <Y>ⓝ염행</>의 보병을 <M>수비</>합니다. <1>12:54</>',
    '<C>●</>10월:천귀병으로 <Y>ⓝ염행</>의 보병을 <M>공격</>합니다. <1>12:55</>',
    '<D><b>위</b></>의 <Y>검증장수</>가 <G><b>낙양</b></>으로 진격합니다.' +
        '<span class="hidden_but_copyable">(전투시드: 0123456789abcdef)</span>',
];

const browser = await chromium.launch({ headless: true });
try {
    const context = await browser.newContext({
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        timezoneId: 'UTC',
    });
    const page = await context.newPage();
    const lines = records.map((record) => `<div class="fixture-line">${formatLog(record)}</div>`).join('');
    await page.setContent(
        `<!doctype html><html><head><style>${css}</style></head><body>` +
            `<div id="container"><div class="RecordZone row gx-0"><div class="GeneralLog col col-12 col-lg-6">` +
            `<div class="bg1 center s-border-tb title">개인 기록</div>${lines}</div></div></div></body></html>`,
        { waitUntil: 'networkidle' }
    );
    await page.evaluate(() => document.fonts.ready);

    for (const viewport of [
        { name: 'desktop', width: 1200, height: 900 },
        { name: 'mobile', width: 500, height: 900 },
    ]) {
        await page.setViewportSize(viewport);
        const measurement = await page.locator('.fixture-line').evaluateAll((elements) =>
            elements.map((element) => {
                const spans = [...element.querySelectorAll('span')];
                const time = spans.find((span) => /^\d{2}:\d{2}$/u.test(span.textContent ?? ''));
                const name = spans.find((span) => span.textContent === 'ⓝ염행');
                const action = spans.find((span) => span.textContent === '수비' || span.textContent === '공격');
                const hiddenSeed = element.querySelector('.hidden_but_copyable');
                if (hiddenSeed instanceof HTMLElement) {
                    const range = document.createRange();
                    range.selectNodeContents(hiddenSeed);
                    const selection = window.getSelection();
                    selection?.removeAllRanges();
                    selection?.addRange(range);
                    const hiddenSeedRect = hiddenSeed.getBoundingClientRect();
                    const hiddenSeedStyle = getComputedStyle(hiddenSeed);
                    const result = {
                        text: hiddenSeed.textContent,
                        selectedText: selection?.toString(),
                        color: hiddenSeedStyle.color,
                        fontSize: hiddenSeedStyle.fontSize,
                        width: hiddenSeedRect.width,
                        height: hiddenSeedRect.height,
                    };
                    selection?.removeAllRanges();
                    return {
                        text: element.textContent,
                        hiddenSeed: result,
                    };
                }
                if (
                    !(time instanceof HTMLElement) ||
                    !(name instanceof HTMLElement) ||
                    !(action instanceof HTMLElement)
                ) {
                    throw new Error('Ref 개인 공격·수비 기록의 비교 span을 찾지 못했습니다.');
                }
                const rect = element.getBoundingClientRect();
                return {
                    text: element.textContent,
                    row: {
                        width: rect.width,
                        height: rect.height,
                        fontSize: getComputedStyle(element).fontSize,
                        lineHeight: getComputedStyle(element).lineHeight,
                    },
                    timeFontSize: getComputedStyle(time).fontSize,
                    nameFontSize: getComputedStyle(name).fontSize,
                    actionFontSize: getComputedStyle(action).fontSize,
                    hiddenSeed: null,
                };
            })
        );
        const output = { viewport, measurement };
        console.log(JSON.stringify(output));
        if (artifactDir) {
            await mkdir(artifactDir, { recursive: true });
            await Promise.all([
                page.screenshot({ path: resolve(artifactDir, `ref-personal-war-log-font-${viewport.name}.png`) }),
                writeFile(
                    resolve(artifactDir, `ref-personal-war-log-font-${viewport.name}.json`),
                    `${JSON.stringify(output, null, 2)}\n`
                ),
            ]);
        }
    }
} finally {
    await browser.close();
}
