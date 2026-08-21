import type { Locator, Page } from '@playwright/test';

type TouchPoint = {
    x: number;
    y: number;
};

type TouchDragOptions = {
    targetYRatio?: number;
};

const pointIn = async (locator: Locator, yRatio = 0.5): Promise<TouchPoint> => {
    const box = await locator.boundingBox();
    if (!box) {
        throw new Error('Touch drag target has no visible bounding box');
    }
    return {
        x: box.x + box.width / 2,
        y: box.y + box.height * yRatio,
    };
};

export const touchDrag = async (
    page: Page,
    source: Locator,
    target: Locator,
    options: TouchDragOptions = {}
): Promise<void> => {
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const from = await pointIn(source);
    const to = await pointIn(target, options.targetYRatio);
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => {
        document.documentElement.removeAttribute('data-playwright-touch-trusted');
        document.addEventListener(
            'touchstart',
            (event) => document.documentElement.setAttribute('data-playwright-touch-trusted', String(event.isTrusted)),
            { capture: true, once: true }
        );
    });

    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...from, id: 0, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await page.waitForTimeout(50);
    const dispatchMove = async (ratio: number) => {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
                {
                    x: from.x + (to.x - from.x) * ratio,
                    y: from.y + (to.y - from.y) * ratio,
                    id: 0,
                    radiusX: 1,
                    radiusY: 1,
                    force: 1,
                },
            ],
        });
    };
    await dispatchMove(0.05);
    await page.waitForTimeout(100);
    for (let step = 2; step <= 20; step += 1) {
        await dispatchMove(step / 20);
        await page.waitForTimeout(16);
    }
    await page.waitForTimeout(50);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const trusted = await page.evaluate(
        () => document.documentElement.getAttribute('data-playwright-touch-trusted') === 'true'
    );
    if (!trusted) {
        throw new Error('Chromium did not dispatch a trusted touchstart event');
    }
};
