import { writeFile } from 'node:fs/promises';
import { expect, type Page, type TestInfo } from '@playwright/test';

// Keep inline markup/ellipsis and cell borders in place. Measure text rather than
// assuming that a computed alignment declaration proves the rendered result.
export const verifyVerticalAlignment = async (
    page: Page,
    testInfo: TestInfo,
    selectors: string[],
    kind: 'block' | 'table' = 'block'
): Promise<void> => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
    });
    for (const selector of selectors) await expect(page.locator(selector).first()).toBeVisible();
    const selector = selectors.join(', ');
    const measure = () =>
        page.locator(selector).evaluateAll((elements) =>
            elements.flatMap((element) => {
                const box = element.getBoundingClientRect();
                if (!box.width || !box.height) return [];
                const style = getComputedStyle(element);
                const range = document.createRange();
                range.selectNodeContents(element);
                const text = range.getBoundingClientRect();
                const top = box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
                const bottom = box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
                return [
                    {
                        className: element.className,
                        text: element.textContent?.trim(),
                        box: { x: box.x, y: box.y, width: box.width, height: box.height },
                        alignContent: style.alignContent,
                        verticalAlign: style.verticalAlign,
                        textAlign: style.textAlign,
                        display: style.display,
                        font: style.font,
                        lineHeight: style.lineHeight,
                        offset: (text.top + text.bottom - top - bottom) / 2,
                        textHeight: text.height,
                        available: bottom - top,
                        html: element.outerHTML,
                    },
                ];
            })
        );
    const baseline = await page.addStyleTag({
        content: `${selector} { ${kind === 'table' ? 'vertical-align: top' : 'align-content: normal'} !important; }`,
    });
    const before = await measure();
    await page.screenshot({ path: testInfo.outputPath('alignment-before.png'), fullPage: true });
    await baseline.evaluate((element) => element.parentNode?.removeChild(element));
    const after = await measure();
    await page.screenshot({ path: testInfo.outputPath('alignment-after.png'), fullPage: true });
    await writeFile(
        testInfo.outputPath('alignment.json'),
        JSON.stringify({ url: page.url(), viewport: page.viewportSize(), before, after }, null, 2)
    );
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBe(before.length);
    for (const [index, item] of after.entries()) {
        const previous = before[index]!;
        expect(item.box, item.className).toEqual(previous.box);
        expect(item.textAlign, item.className).toBe(previous.textAlign);
        expect(item.text, item.className).toBe(previous.text);
        if (kind === 'table') expect(item.verticalAlign, item.className).toBe('middle');
        else expect(item.alignContent, item.className).toBe('safe center');
        if (
            item.textHeight > 0 &&
            item.textHeight <= item.available &&
            !['flex', 'inline-flex'].includes(item.display)
        ) {
            // Font ascenders/descenders need not have identical ink extents.
            expect(Math.abs(item.offset), item.className).toBeLessThanOrEqual(2);
        }
    }
};
