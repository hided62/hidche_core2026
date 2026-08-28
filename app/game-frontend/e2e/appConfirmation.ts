import { expect, type Page } from '@playwright/test';

export const acceptAppConfirmation = async (page: Page, message: string): Promise<void> => {
    const dialog = page.getByTestId('game-notice-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(message);
    await dialog.getByRole('button', { name: '확인', exact: true }).click();
    await expect(dialog).toBeHidden();
};
