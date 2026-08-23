export const RANK_DATA_TYPES = [
    'experience',
    'dedication',
    'firenum',
    'warnum',
    'killnum',
    'deathnum',
    'occupied',
    'killcrew',
    'deathcrew',
    'killcrew_person',
    'deathcrew_person',
    'dex1',
    'dex2',
    'dex3',
    'dex4',
    'dex5',
    'ttw',
    'ttd',
    'ttl',
    'ttg',
    'ttp',
    'tlw',
    'tld',
    'tll',
    'tlg',
    'tlp',
    'tsw',
    'tsd',
    'tsl',
    'tsg',
    'tsp',
    'tiw',
    'tid',
    'til',
    'tig',
    'tip',
    'betwin',
    'betgold',
    'betwingold',
    'inherit_earned',
    'inherit_spent',
    'inherit_earned_dyn',
    'inherit_earned_act',
    'inherit_spent_dyn',
] as const;

export type RankDataType = (typeof RANK_DATA_TYPES)[number];

/**
 * Legacy `sammo\Enums\RankColumn` values stored in `rank_data`.
 *
 * `experience`, `dedication`, and `dex1` through `dex5` are natural general
 * columns in the reference implementation. core2026 currently keeps mirrored
 * rank rows for those values as a compatibility cache, but differential
 * snapshots must compare this legacy set rather than treating the mirrors as
 * source-of-truth rows.
 */
export const LEGACY_RANK_DATA_TYPES = [
    'firenum',
    'warnum',
    'killnum',
    'deathnum',
    'killcrew',
    'deathcrew',
    'ttw',
    'ttd',
    'ttl',
    'ttg',
    'ttp',
    'tlw',
    'tld',
    'tll',
    'tlg',
    'tlp',
    'tsw',
    'tsd',
    'tsl',
    'tsg',
    'tsp',
    'tiw',
    'tid',
    'til',
    'tig',
    'tip',
    'betwin',
    'betgold',
    'betwingold',
    'killcrew_person',
    'deathcrew_person',
    'occupied',
    'inherit_earned',
    'inherit_spent',
    'inherit_earned_dyn',
    'inherit_earned_act',
    'inherit_spent_dyn',
] as const satisfies readonly RankDataType[];

export type LegacyRankDataType = (typeof LEGACY_RANK_DATA_TYPES)[number];

const PREFIXED_RANK_DATA_TYPES = new Set<RankDataType>([
    'warnum',
    'killnum',
    'deathnum',
    'occupied',
    'killcrew',
    'deathcrew',
    'killcrew_person',
    'deathcrew_person',
]);

export const rankDataMetaKey = (type: RankDataType): string =>
    PREFIXED_RANK_DATA_TYPES.has(type) ? `rank_${type}` : type;

export const HALL_OF_FAME_TYPES = [
    'experience',
    'dedication',
    'firenum',
    'warnum',
    'killnum',
    'winrate',
    'occupied',
    'killcrew',
    'killrate',
    'killcrew_person',
    'killrate_person',
    'dex1',
    'dex2',
    'dex3',
    'dex4',
    'dex5',
    'ttrate',
    'tlrate',
    'tsrate',
    'tirate',
    'betgold',
    'betwin',
    'betwingold',
    'betrate',
    'inherit_earned',
] as const;

export type HallOfFameType = (typeof HALL_OF_FAME_TYPES)[number];
