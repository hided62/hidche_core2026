import type { CanonicalTurnSnapshot } from './canonical.js';

const roundHalfEven = (value: number): number => {
    const lower = Math.floor(value);
    const fraction = value - lower;
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 4;
    if (Math.abs(fraction - 0.5) <= tolerance) {
        return lower % 2 === 0 ? lower : lower + 1;
    }
    return Math.round(value);
};

/**
 * Test-only projection for a MariaDB FLOAT read through the Ref PHP service.
 * Core product state intentionally keeps JavaScript/PostgreSQL precision; this
 * oracle is only used to prove that an explicitly enumerated raw difference is
 * caused by Ref's binary32 write and six-significant-digit read boundary.
 */
export const projectRefFloatRead = (value: number): number => {
    const stored = Math.fround(value);
    if (!Number.isFinite(stored) || stored === 0) {
        return stored;
    }
    const sign = stored < 0 ? -1 : 1;
    const absolute = Math.abs(stored);
    const exponent = Math.floor(Math.log10(absolute));
    const scale = 10 ** (5 - exponent);
    return sign * (roundHalfEven(absolute * scale) / scale);
};

export interface RefFloatSnapshotProjection {
    cityTrust?: boolean;
    nationTech?: boolean;
}

const projectField = (row: Record<string, unknown>, field: string): Record<string, unknown> => {
    const value = row[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return row;
    }
    return { ...row, [field]: projectRefFloatRead(value) };
};

export const projectSnapshotThroughRefFloatRead = (
    snapshot: CanonicalTurnSnapshot,
    projection: RefFloatSnapshotProjection
): CanonicalTurnSnapshot => ({
    ...snapshot,
    cities: projection.cityTrust ? snapshot.cities.map((city) => projectField(city, 'trust')) : snapshot.cities,
    nations: projection.nationTech ? snapshot.nations.map((nation) => projectField(nation, 'tech')) : snapshot.nations,
});
