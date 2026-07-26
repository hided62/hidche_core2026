const DEFAULT_MIN_RESOURCE_ACTION_AMOUNT = 100;
const DEFAULT_MAX_RESOURCE_ACTION_AMOUNT = 10_000;
const RESOURCE_ACTION_AMOUNT_UNIT = 100;

export const normalizeResourceActionAmount = (amount: number, configuredMaxAmount: number): number | null => {
    if (!Number.isFinite(amount)) {
        return null;
    }

    const maxAmount = configuredMaxAmount > 0 ? configuredMaxAmount : DEFAULT_MAX_RESOURCE_ACTION_AMOUNT;
    const roundedAmount = Math.round(amount / RESOURCE_ACTION_AMOUNT_UNIT) * RESOURCE_ACTION_AMOUNT_UNIT;

    return Math.max(DEFAULT_MIN_RESOURCE_ACTION_AMOUNT, Math.min(roundedAmount, maxAmount));
};
