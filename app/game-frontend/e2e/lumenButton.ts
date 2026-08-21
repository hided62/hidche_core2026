import { expect, type Locator, type Page } from '@playwright/test';

type ButtonGeometry = {
    top: number;
    bottom: number;
    height: number;
    marginTop: string;
    borderBottomWidth: string;
    borderRadius: string;
    backgroundColor: string;
};

const measure = (control: Locator): Promise<ButtonGeometry> =>
    control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
            marginTop: style.marginTop,
            borderBottomWidth: style.borderBottomWidth,
            borderRadius: style.borderRadius,
            backgroundColor: style.backgroundColor,
        };
    });

export const expectLumenButtonStates = async (
    page: Page,
    control: Locator,
    expectedBackground: string
): Promise<{ base: ButtonGeometry; hover: ButtonGeometry; active: ButtonGeometry }> => {
    await expect(control).toBeVisible();
    await page.mouse.move(0, 0);
    const base = await measure(control);
    expect(base).toMatchObject({
        marginTop: '0px',
        borderBottomWidth: '4px',
        borderRadius: '5.25px',
        backgroundColor: expectedBackground,
    });

    await control.hover();
    const hover = await measure(control);
    expect(hover).toMatchObject({ marginTop: '1px', borderBottomWidth: '3px' });
    expect(hover.top).toBeCloseTo(base.top + 1, 1);
    expect(hover.bottom).toBeCloseTo(base.bottom, 1);

    const box = await control.boundingBox();
    if (!box) throw new Error('Lumen button is not measurable');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const active = await measure(control);
    expect(active).toMatchObject({ marginTop: '2px', borderBottomWidth: '2px' });
    expect(active.top).toBeCloseTo(base.top + 2, 1);
    expect(active.bottom).toBeCloseTo(base.bottom, 1);
    await page.mouse.move(0, 0);
    await page.mouse.up();

    await page.keyboard.press('Tab');
    await control.focus();
    await expect(control).toBeFocused();
    await expect.poll(() => control.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');

    return { base, hover, active };
};
