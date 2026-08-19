import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

const refRoot = resolve(process.env.REF_SAM_ROOT ?? '/home/letrhee/sam_rebuild/ref/sam');
const artifactDir = process.env.REF_PERSONAL_BATTLE_LOG_ARTIFACT_DIR;
const formatterUrl = pathToFileURL(resolve(refRoot, 'hwe/ts/utilGame/formatLog.ts')).href;
const { formatLog } = await import(formatterUrl);
const css = await readFile(resolve(refRoot, 'dist_js/hwe_dynamic/vue/v_main.css'), 'utf8');
const record =
    '<S>◆</>188년 2월:<div class="small_war_log">' +
    '<span class="me"><span class="name_plate"><span class="crew_type">남귀</span> ' +
    '<span class="name_plate_cover">【<span class="name">운영자</span>】</span></span> ' +
    '<span class="crew_plate"><span class="remain_crew">0</span>' +
    '<span class="killed_plate">(<span class="killed_crew">-4404</span>)</span></span></span> ' +
    '<span class="war_type war_type_defense">←</span> ' +
    '<span class="you"><span class="crew_plate"><span class="remain_crew">555</span>' +
    '<span class="killed_plate">(<span class="killed_crew">-6845</span>)</span></span> ' +
    '<span class="name_plate"><span class="crew_type">기병</span> ' +
    '<span class="name_plate_cover">【<span class="name">ⓝ독야청정</span>】</span></span></span></div>';

const browser = await chromium.launch({ headless: true });
try {
    const context = await browser.newContext({
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        timezoneId: 'UTC',
    });
    const page = await context.newPage();
    await page.setContent(
        `<!doctype html><html><head><style>${css}</style></head><body>` +
            `<div id="container"><div class="RecordZone row gx-0"><div class="GeneralLog col col-12 col-lg-6">` +
            `<div class="bg1 center s-border-tb title">개인 기록</div><div class="fixture-line">${formatLog(record)}</div>` +
            `</div></div></div></body></html>`,
        { waitUntil: 'networkidle' }
    );
    await page.evaluate(() => document.fonts.ready);

    for (const viewport of [
        { name: 'desktop', width: 1200, height: 900 },
        { name: 'mobile', width: 500, height: 900 },
    ]) {
        await page.setViewportSize(viewport);
        const measurement = await page.locator('.fixture-line').evaluate((element) => {
            const requireElement = (selector) => {
                const target = element.querySelector(selector);
                if (!(target instanceof HTMLElement)) throw new Error(`Ref 전투기록 요소를 찾지 못했습니다: ${selector}`);
                return target;
            };
            const rect = element.getBoundingClientRect();
            const battle = requireElement('.small_war_log');
            const battleRect = battle.getBoundingClientRect();
            return {
                text: element.textContent,
                line: { height: rect.height, fontSize: getComputedStyle(element).fontSize },
                battle: { height: battleRect.height, display: getComputedStyle(battle).display },
                styles: {
                    diamondColor: getComputedStyle(requireElement('span[style*="skyblue"]')).color,
                    namePlateFontSize: getComputedStyle(requireElement('.me .name_plate')).fontSize,
                    nameCoverColor: getComputedStyle(requireElement('.me .name_plate_cover')).color,
                    crewPlateColor: getComputedStyle(requireElement('.me .crew_plate')).color,
                    crewPlateFontSize: getComputedStyle(requireElement('.me .crew_plate')).fontSize,
                    defenseArrowColor: getComputedStyle(requireElement('.war_type_defense')).color,
                },
            };
        });
        const output = { viewport, measurement };
        console.log(JSON.stringify(output));
        if (artifactDir) {
            await mkdir(artifactDir, { recursive: true });
            await Promise.all([
                page.screenshot({ path: resolve(artifactDir, `ref-personal-battle-log-colors-${viewport.name}.png`) }),
                writeFile(
                    resolve(artifactDir, `ref-personal-battle-log-colors-${viewport.name}.json`),
                    `${JSON.stringify(output, null, 2)}\n`
                ),
            ]);
        }
    }
} finally {
    await browser.close();
}
