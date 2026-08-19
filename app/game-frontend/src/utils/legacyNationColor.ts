const lightTextBackgrounds = new Set([
    '',
    '#330000',
    '#FF0000',
    '#800000',
    '#A0522D',
    '#FF6347',
    '#808000',
    '#008000',
    '#2E8B57',
    '#008080',
    '#6495ED',
    '#0000FF',
    '#000080',
    '#483D8B',
    '#7B68EE',
    '#800080',
    '#A9A9A9',
    '#000000',
]);

export const legacyNationTextColor = (backgroundColor: string): '#FFFFFF' | '#000000' =>
    lightTextBackgrounds.has(backgroundColor.toUpperCase()) ? '#FFFFFF' : '#000000';

/** Mirrors Ref `isBrightColor()`, used by Vue nation labels and message targets. */
export const isLegacyNationColorBright = (backgroundColor: string): boolean => {
    const normalized = backgroundColor.trim().replace(/^#/u, '');
    if (!/^[0-9a-f]{6}$/iu.test(normalized)) return false;

    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return red * 0.299 + green * 0.587 + blue * 0.114 > 140;
};

export const legacyLuminanceTextColor = (backgroundColor: string): '#000000' | '#FFFFFF' =>
    isLegacyNationColorBright(backgroundColor) ? '#000000' : '#FFFFFF';
