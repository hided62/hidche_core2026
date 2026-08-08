import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';

const refRoot = process.env.REF_SAM_ROOT;
const artifactRoot = process.env.KAKAO_OTP_ARTIFACT_DIR;
if (!refRoot || !artifactRoot) {
    throw new Error('REF_SAM_ROOT and KAKAO_OTP_ARTIFACT_DIR are required.');
}

const modalHtml = `
<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
  <div class="modal show" id="modalOTP" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-modal="true" style="display:block">
    <div class="modal-dialog" role="document">
      <div class="modal-content">
        <form id="otp_form" method="post" action="#">
          <div class="modal-header">
            <h5 class="modal-title" id="exampleModalLabel">인증 코드 필요</h5>
            <button type="button" class="close" aria-label="Close"><span aria-hidden="true">&times;</span></button>
          </div>
          <div class="modal-body">
            <div>인증 코드가 필요합니다.<br><br>카카오톡의 '나와의 채팅'란을 확인해 주세요.<br>(별도의 알림[소리, 진동, 숫자]이 발생하지 않습니다.)</div>
            <div class="input-group mt-4" role="group">
              <div class="input-group-text">인증 코드</div>
              <input type="number" class="form-control" name="otp" id="otp_code" placeholder="인증 코드">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary">취소</button>
            <button type="submit" class="btn btn-primary">제출</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</body>
</html>`;

await mkdir(artifactRoot, { recursive: true });
const browser = await chromium.launch();
try {
    for (const viewport of [
        { name: 'desktop', width: 1200, height: 900 },
        { name: 'mobile', width: 390, height: 844 },
    ]) {
        const page = await browser.newPage({ viewport });
        await page.setContent(modalHtml);
        await page.addStyleTag({ path: resolve(refRoot, 'dist_js/gateway/common_ts.css') });
        await page.addStyleTag({ path: resolve(refRoot, 'd_shared/common.css') });
        await page.addStyleTag({ path: resolve(refRoot, 'dist_js/gateway/login.css') });
        await page.addStyleTag({
            content: '.modal { background: rgb(0 0 0 / 60%); } body { background: #000; }',
        });
        const dialog = page.locator('#modalOTP .modal-content');
        const input = page.locator('#otp_code');
        const submit = page.getByRole('button', { name: '제출' });
        const readSubmitStyle = () =>
            submit.evaluate((element) => {
                const style = getComputedStyle(element);
                return {
                    backgroundColor: style.backgroundColor,
                    borderColor: style.borderColor,
                    color: style.color,
                    outline: style.outline,
                    boxShadow: style.boxShadow,
                    opacity: style.opacity,
                    cursor: style.cursor,
                };
            });
        await page.waitForTimeout(250);
        const states = { normal: await readSubmitStyle() };
        await submit.hover();
        await page.waitForTimeout(250);
        states.hover = await readSubmitStyle();
        await input.focus();
        await input.press('Tab');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(250);
        states.focusVisible = await readSubmitStyle();
        const submitBox = await submit.boundingBox();
        if (!submitBox) throw new Error('Ref OTP submit button has no geometry.');
        await page.mouse.move(submitBox.x + submitBox.width / 2, submitBox.y + submitBox.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(250);
        states.active = await readSubmitStyle();
        await page.mouse.move(1, 1);
        await page.mouse.up();
        await submit.evaluate((element) => {
            element.disabled = true;
        });
        await page.waitForTimeout(250);
        states.disabled = await readSubmitStyle();
        const geometry = await dialog.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                backgroundColor: style.backgroundColor,
                border: style.border,
                fontSize: style.fontSize,
            };
        });
        await page.screenshot({ path: resolve(artifactRoot, `kakao-otp-ref-${viewport.name}.png`), fullPage: true });
        await writeFile(
            resolve(artifactRoot, `kakao-otp-ref-${viewport.name}.json`),
            `${JSON.stringify({ ...geometry, submitStates: states }, null, 2)}\n`,
            'utf8'
        );
        await page.close();
    }
} finally {
    await browser.close();
}
