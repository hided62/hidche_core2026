export const NON_AGGRESSION_MIN_TERM_MONTHS = 6;
export const NON_AGGRESSION_MAX_END_YEAR_OFFSET = 20;

export const resolveNonAggressionMaxEndYear = (currentYear: number): number =>
    currentYear + NON_AGGRESSION_MAX_END_YEAR_OFFSET;
