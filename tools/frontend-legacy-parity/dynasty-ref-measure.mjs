import { chromium } from '@playwright/test';

const baseUrl = process.env.DYNASTY_REF_URL ?? 'http://127.0.0.1:3410/hwe';
const detailId = process.env.DYNASTY_REF_DETAIL_ID ?? '1';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'ko-KR',
});

const measure = async (url) => {
    await page.goto(url, { waitUntil: 'networkidle' });
    return page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table')).map((table) => {
            const rect = table.getBoundingClientRect();
            const style = getComputedStyle(table);
            return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                backgroundImage: style.backgroundImage,
                borderSpacing: style.borderSpacing,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
            };
        });
        const button = document.querySelector('button');
        const buttonStyle = button ? getComputedStyle(button) : null;
        const firstCell = document.querySelector('td');
        const firstCellStyle = firstCell ? getComputedStyle(firstCell) : null;
        return {
            chromium: navigator.userAgent,
            body: {
                width: document.body.getBoundingClientRect().width,
                minWidth: getComputedStyle(document.body).minWidth,
                margin: getComputedStyle(document.body).margin,
                fontFamily: getComputedStyle(document.body).fontFamily,
                fontSize: getComputedStyle(document.body).fontSize,
                lineHeight: getComputedStyle(document.body).lineHeight,
            },
            tables,
            button: buttonStyle
                ? {
                      height: button.getBoundingClientRect().height,
                      borderWidth: buttonStyle.borderWidth,
                      borderRadius: buttonStyle.borderRadius,
                      backgroundColor: buttonStyle.backgroundColor,
                      color: buttonStyle.color,
                      padding: buttonStyle.padding,
                      fontFamily: buttonStyle.fontFamily,
                      fontSize: buttonStyle.fontSize,
                      lineHeight: buttonStyle.lineHeight,
                      cursor: buttonStyle.cursor,
                  }
                : null,
            firstCell: firstCellStyle
                ? {
                      padding: firstCellStyle.padding,
                      borderWidth: firstCellStyle.borderWidth,
                      textAlign: firstCellStyle.textAlign,
                  }
                : null,
        };
    });
};

const output = {
    list: await measure(`${baseUrl}/a_emperior.php`),
    detail: await measure(`${baseUrl}/a_emperior_detail.php?select=${detailId}`),
};

if (process.env.FRONTEND_PARITY_ARTIFACT_DIR) {
    await page.goto(`${baseUrl}/a_emperior.php`, { waitUntil: 'networkidle' });
    await page.screenshot({
        path: `${process.env.FRONTEND_PARITY_ARTIFACT_DIR}/dynasty-ref-list.png`,
        fullPage: true,
    });
    if (process.env.DYNASTY_REF_CAPTURE_DETAIL === '1') {
        await page.goto(`${baseUrl}/a_emperior_detail.php?select=${detailId}`, { waitUntil: 'networkidle' });
        await page.screenshot({
            path: `${process.env.FRONTEND_PARITY_ARTIFACT_DIR}/dynasty-ref-detail.png`,
            fullPage: true,
        });
    }
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
await browser.close();
