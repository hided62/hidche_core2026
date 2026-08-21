import type { Locator, Page } from '@playwright/test';

type TouchPoint = {
    x: number;
    y: number;
};

type TouchDragOptions = {
    targetYRatio?: number;
};

const pointInStable = async (locator: Locator, yRatio = 0.5): Promise<TouchPoint> => {
    let previous: TouchPoint | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        await locator.evaluate(
            () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        );
        const box = await locator.boundingBox();
        if (!box) {
            throw new Error('Touch drag target has no visible bounding box');
        }
        const point = {
            x: box.x + box.width / 2,
            y: box.y + box.height * yRatio,
        };
        if (previous && Math.abs(previous.x - point.x) < 0.25 && Math.abs(previous.y - point.y) < 0.25) {
            return point;
        }
        previous = point;
    }
    if (!previous) throw new Error('Touch drag target did not produce a stable point');
    return previous;
};

export const touchDrag = async (
    page: Page,
    source: Locator,
    target: Locator,
    options: TouchDragOptions = {}
): Promise<void> => {
    const cdp = await page.context().newCDPSession(page);
    let from: TouchPoint | null = null;
    let to: TouchPoint | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        await source.scrollIntoViewIfNeeded();
        await target.scrollIntoViewIfNeeded();
        from = await pointInStable(source);
        to = await pointInStable(target, options.targetYRatio);
        await page.evaluate(() => {
            for (const element of document.querySelectorAll('[data-playwright-touch-source]')) {
                element.removeAttribute('data-playwright-touch-source');
            }
        });
        await source.evaluate((element) => element.setAttribute('data-playwright-touch-source', ''));
        await page.evaluate(() => {
            document.documentElement.removeAttribute('data-playwright-touch-trusted');
            document.documentElement.removeAttribute('data-playwright-touch-source-hit');
            document.addEventListener(
                'touchstart',
                (event) => {
                    const sourceElement = document.querySelector('[data-playwright-touch-source]');
                    document.documentElement.setAttribute('data-playwright-touch-trusted', String(event.isTrusted));
                    document.documentElement.setAttribute(
                        'data-playwright-touch-source-hit',
                        String(event.target instanceof Node && sourceElement?.contains(event.target))
                    );
                },
                { capture: true, once: true }
            );
        });

        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ ...from, id: 0, radiusX: 1, radiusY: 1, force: 1 }],
        });
        await page.waitForTimeout(50);
        const startState = await page.evaluate(() => ({
            trusted: document.documentElement.getAttribute('data-playwright-touch-trusted') === 'true',
            sourceHit: document.documentElement.getAttribute('data-playwright-touch-source-hit') === 'true',
        }));
        if (!startState.trusted) {
            throw new Error('Chromium did not dispatch a trusted touchstart event');
        }
        if (startState.sourceHit) break;

        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await page.evaluate(() => {
            for (const element of document.querySelectorAll('[data-playwright-touch-source]')) {
                element.removeAttribute('data-playwright-touch-source');
            }
        });
        from = null;
        to = null;
    }

    if (!from || !to) {
        throw new Error('Trusted touchstart did not land on the requested drag source');
    }

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
    await page.evaluate(() => {
        for (const element of document.querySelectorAll('[data-playwright-touch-source]')) {
            element.removeAttribute('data-playwright-touch-source');
        }
    });
};
