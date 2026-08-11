export const DEX_LEVELS = [
    [0, 'navy', 'F-'],
    [350, 'navy', 'F'],
    [1_375, 'navy', 'F+'],
    [3_500, 'skyblue', 'E-'],
    [7_125, 'skyblue', 'E'],
    [12_650, 'skyblue', 'E+'],
    [20_475, 'seagreen', 'D-'],
    [31_000, 'seagreen', 'D'],
    [44_625, 'seagreen', 'D+'],
    [61_750, 'teal', 'C-'],
    [82_775, 'teal', 'C'],
    [108_100, 'teal', 'C+'],
    [138_125, 'limegreen', 'B-'],
    [173_250, 'limegreen', 'B'],
    [213_875, 'limegreen', 'B+'],
    [260_400, 'darkorange', 'A-'],
    [313_225, 'darkorange', 'A'],
    [372_750, 'darkorange', 'A+'],
    [439_375, 'tomato', 'S-'],
    [513_500, 'tomato', 'S'],
    [595_525, 'tomato', 'S+'],
    [685_850, 'darkviolet', 'Z-'],
    [784_875, 'darkviolet', 'Z'],
    [893_000, 'darkviolet', 'Z+'],
    [1_010_625, 'gold', 'EX-'],
    [1_138_150, 'gold', 'EX'],
    [1_275_975, 'white', 'EX+'],
] as const;

export const DEX_EX_PLUS = DEX_LEVELS.at(-1)![0];

export type DexProgress = {
    level: number;
    name: string;
    color: string;
    overallPercent: number;
    gradePercent: number;
    nextName: string | null;
    remaining: number;
};

const finiteNonNegative = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

export const clampPercent = (value: number): number => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

export const ratioPercent = (current: number, maximum: number): number =>
    maximum > 0 ? clampPercent((finiteNonNegative(current) / maximum) * 100) : 0;

export const legacyExperiencePercent = (experience: number, level: number): number => {
    const safeExperience = finiteNonNegative(experience);
    const safeLevel = Math.max(0, Math.floor(finiteNonNegative(level)));
    if (safeExperience < 100) return clampPercent(safeExperience);
    if (safeExperience < 1_000) return clampPercent(safeExperience - safeLevel * 100);
    return clampPercent(((safeExperience - 10 * safeLevel ** 2) / (2 * safeLevel + 1)) * 10);
};

export const dexProgress = (rawDex: number): DexProgress => {
    const dex = finiteNonNegative(rawDex);
    let level = 0;
    for (let index = 1; index < DEX_LEVELS.length; index += 1) {
        if (dex < DEX_LEVELS[index]![0]) break;
        level = index;
    }

    const [floor, color, name] = DEX_LEVELS[level]!;
    const next = DEX_LEVELS[level + 1];
    const gradePercent = next ? ratioPercent(dex - floor, next[0] - floor) : 100;
    return {
        level,
        name,
        color,
        overallPercent: ratioPercent(dex, DEX_EX_PLUS),
        gradePercent,
        nextName: next?.[2] ?? null,
        remaining: next ? Math.max(0, next[0] - dex) : 0,
    };
};
