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
