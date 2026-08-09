export type GeneralStatRules = {
    min: number;
    max: number;
    total: number;
};

export type GeneralStats = [leadership: number, strength: number, intel: number];

type RandomSource = () => number;

export const abilityRand = (stats: GeneralStatRules, random: RandomSource = Math.random): GeneralStats => {
    let leadership = random() * 65 + 10;
    let strength = random() * 65 + 10;
    let intel = random() * 65 + 10;
    const rate = leadership + strength + intel;

    leadership = Math.floor((leadership / rate) * stats.total);
    strength = Math.floor((strength / rate) * stats.total);
    intel = Math.floor((intel / rate) * stats.total);

    while (leadership + strength + intel < stats.total) {
        leadership += 1;
    }

    if (
        leadership > stats.max ||
        strength > stats.max ||
        intel > stats.max ||
        leadership < stats.min ||
        strength < stats.min ||
        intel < stats.min
    ) {
        return abilityRand(stats, random);
    }

    return [leadership, strength, intel];
};

export const abilityLeadpow = (stats: GeneralStatRules, random: RandomSource = Math.random): GeneralStats => {
    let leadership = random() * 6;
    let strength = random() * 6;
    let intel = random();
    const rate = leadership + strength + intel;

    leadership = Math.floor((leadership / rate) * stats.total);
    strength = Math.floor((strength / rate) * stats.total);
    intel = Math.floor((intel / rate) * stats.total);

    while (leadership + strength + intel < stats.total) {
        strength += 1;
    }

    if (intel < stats.min) {
        leadership -= stats.min - intel;
        intel = stats.min;
    }
    if (leadership > stats.max) {
        strength += leadership - stats.max;
        leadership = stats.max;
    }
    if (strength > stats.max) {
        leadership += strength - stats.max;
        strength = stats.max;
    }
    if (leadership > stats.max) {
        intel += leadership - stats.max;
        leadership = stats.max;
    }

    return [leadership, strength, intel];
};

export const abilityLeadint = (stats: GeneralStatRules, random: RandomSource = Math.random): GeneralStats => {
    let leadership = random() * 6;
    let strength = random();
    let intel = random() * 6;
    const rate = leadership + strength + intel;

    leadership = Math.floor((leadership / rate) * stats.total);
    strength = Math.floor((strength / rate) * stats.total);
    intel = Math.floor((intel / rate) * stats.total);

    while (leadership + strength + intel < stats.total) {
        intel += 1;
    }

    if (strength < stats.min) {
        leadership -= stats.min - strength;
        strength = stats.min;
    }
    if (leadership > stats.max) {
        intel += leadership - stats.max;
        leadership = stats.max;
    }
    if (intel > stats.max) {
        leadership += intel - stats.max;
        intel = stats.max;
    }
    if (leadership > stats.max) {
        strength += leadership - stats.max;
        leadership = stats.max;
    }

    return [leadership, strength, intel];
};

export const abilityPowint = (stats: GeneralStatRules, random: RandomSource = Math.random): GeneralStats => {
    let leadership = random();
    let strength = random() * 6;
    let intel = random() * 6;
    const rate = leadership + strength + intel;

    leadership = Math.floor((leadership / rate) * stats.total);
    strength = Math.floor((strength / rate) * stats.total);
    intel = Math.floor((intel / rate) * stats.total);

    while (leadership + strength + intel < stats.total) {
        intel += 1;
    }

    if (leadership < stats.min) {
        strength -= stats.min - leadership;
        leadership = stats.min;
    }
    if (strength > stats.max) {
        intel += strength - stats.max;
        strength = stats.max;
    }
    if (intel > stats.max) {
        strength += intel - stats.max;
        intel = stats.max;
    }
    if (strength > stats.max) {
        leadership += strength - stats.max;
        strength = stats.max;
    }

    return [leadership, strength, intel];
};
