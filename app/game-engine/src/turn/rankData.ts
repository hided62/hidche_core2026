import {
    LEGACY_RANK_DATA_TYPES,
    RANK_DATA_TYPES,
    rankDataMetaKey,
    type LegacyRankDataType,
    type RankDataType,
} from '@sammo-ts/common';

export interface RankedGeneralState {
    id: number;
    nationId: number;
    experience: number;
    dedication: number;
    meta: unknown;
}

export interface PersistedRankRow {
    generalId: number;
    nationId: number;
    type: RankDataType;
    value: number;
}

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
const toLegacyDatabaseInt = (value: number): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
};

const readMetaNumber = (meta: Record<string, unknown>, key: string): number => {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return toLegacyDatabaseInt(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? toLegacyDatabaseInt(parsed) : 0;
    }
    return 0;
};

export const rankMetaKey = rankDataMetaKey;

export const buildPersistedRankRows = (general: RankedGeneralState): PersistedRankRow[] => {
    const meta = asRecord(general.meta);
    return RANK_DATA_TYPES.map((type) => {
        const value =
            type === 'experience'
                ? toLegacyDatabaseInt(general.experience)
                : type === 'dedication'
                  ? toLegacyDatabaseInt(general.dedication)
                  : readMetaNumber(meta, rankMetaKey(type));
        return {
            generalId: general.id,
            nationId: general.nationId,
            type,
            value,
        };
    });
};

/**
 * Ref GeneralBuilder/Join initializes every rank row in nation 0 with value 0.
 * The one exception is a user-creation inheritance debit already carried in
 * `inherit_spent_dyn`. Keep this persistence boundary shared by the database
 * hooks and differential projection.
 */
export const buildInitialRankRows = (general: RankedGeneralState): PersistedRankRow[] =>
    buildPersistedRankRows(general).map((row) => ({
        ...row,
        nationId: 0,
        value: row.type === 'inherit_spent_dyn' ? row.value : 0,
    }));

export const buildLegacyComparableInitialRankRows = (
    general: RankedGeneralState
): Array<PersistedRankRow & { type: LegacyRankDataType }> => {
    const legacyTypes = new Set<RankDataType>(LEGACY_RANK_DATA_TYPES);
    return buildInitialRankRows(general).filter((row): row is PersistedRankRow & { type: LegacyRankDataType } =>
        legacyTypes.has(row.type)
    );
};

export const buildLegacyComparableRankRows = (
    general: RankedGeneralState
): Array<PersistedRankRow & { type: LegacyRankDataType }> => {
    const legacyTypes = new Set<RankDataType>(LEGACY_RANK_DATA_TYPES);
    return buildPersistedRankRows(general).filter((row): row is PersistedRankRow & { type: LegacyRankDataType } =>
        legacyTypes.has(row.type)
    );
};

export const applyPersistedRankRowsToMeta = (
    rawMeta: Record<string, unknown>,
    rows: ReadonlyArray<{ type: string; value: number }>
): void => {
    const supportedTypes = new Set<string>(RANK_DATA_TYPES);
    for (const row of rows) {
        if (row.type === 'experience' || row.type === 'dedication' || !supportedTypes.has(row.type)) {
            continue;
        }
        rawMeta[rankMetaKey(row.type as RankDataType)] = row.value;
    }
};
