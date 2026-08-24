export const applyLegacyInjury = (value: number, injury: number): number => value * ((100 - injury) / 100);

export const finalizeLegacyStat = (value: number): number => Math.trunc(value);
