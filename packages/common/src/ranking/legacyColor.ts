const LEGACY_WHITE_TEXT_COLORS = new Set([
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

export const resolveLegacyTextColor = (backgroundColor: string): '#ffffff' | '#000000' =>
    LEGACY_WHITE_TEXT_COLORS.has(backgroundColor.toUpperCase()) ? '#ffffff' : '#000000';
