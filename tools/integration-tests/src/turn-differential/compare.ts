import type { CanonicalTurnSnapshot } from './canonical.js';

export interface SnapshotDifference {
    path: string;
    reference: unknown;
    core: unknown;
}

export interface SnapshotComparisonOptions {
    ignoredPathPatterns?: RegExp[];
    numericTolerance?: number;
}

type FlatSnapshot = Map<string, unknown>;

const flatArray = Symbol('turn-snapshot-array');
const flatObject = Symbol('turn-snapshot-object');
const flatMissing = Symbol('turn-snapshot-missing');

const publicFlatStates = {
    array: Object.freeze({ $snapshotState: 'array' }),
    object: Object.freeze({ $snapshotState: 'object' }),
    missing: Object.freeze({ $snapshotState: 'missing' }),
} as const;

interface EntityIdentity {
    key: string;
    semantic: boolean;
}

const entityIdentity = (value: Record<string, unknown>, index: number, path: string): EntityIdentity => {
    if (
        (typeof value.generalId === 'number' || typeof value.generalId === 'string') &&
        typeof value.type === 'string'
    ) {
        return { key: `${String(value.generalId)}:${value.type}`, semantic: true };
    }
    if (
        (path === 'world.generalCooldowns' || path === 'world.nationCooldowns') &&
        typeof value.actionName === 'string'
    ) {
        for (const key of ['generalId', 'nationId']) {
            const candidate = value[key];
            if (typeof candidate === 'number' || typeof candidate === 'string') {
                return { key: `${String(candidate)}:${value.actionName}`, semantic: true };
            }
        }
    }
    for (const key of ['id', 'generalId', 'nationId', 'fromNationId']) {
        const candidate = value[key];
        if (typeof candidate === 'number' || typeof candidate === 'string') {
            if (key === 'fromNationId' && value.toNationId !== undefined) {
                return { key: `${String(candidate)}->${String(value.toNationId)}`, semantic: true };
            }
            if (value.turnIndex !== undefined) {
                return {
                    key: `${String(candidate)}:${String(value.officerLevel ?? '')}:${String(value.turnIndex)}`,
                    semantic: true,
                };
            }
            return { key: String(candidate), semantic: true };
        }
    }
    return { key: String(index), semantic: false };
};

const flatten = (value: unknown, path: string, output: FlatSnapshot): void => {
    if (Array.isArray(value)) {
        output.set(path, flatArray);
        const semanticKeys = new Map<string, number>();
        value.forEach((entry, index) => {
            const identity =
                path === 'logs' || path === 'messages'
                    ? { key: String(index), semantic: false }
                    : typeof entry === 'object' && entry !== null && !Array.isArray(entry)
                      ? entityIdentity(entry as Record<string, unknown>, index, path)
                      : { key: String(index), semantic: false };
            if (identity.semantic) {
                const firstIndex = semanticKeys.get(identity.key);
                if (firstIndex !== undefined) {
                    throw new Error(
                        `Duplicate semantic entity key ${JSON.stringify(identity.key)} at ${JSON.stringify(
                            path
                        )}: indexes ${firstIndex} and ${index}`
                    );
                }
                semanticKeys.set(identity.key, index);
            }
            flatten(entry, `${path}[${identity.key}]`, output);
        });
        return;
    }
    if (typeof value === 'object' && value !== null) {
        output.set(path, flatObject);
        const record = value as Record<string, unknown>;
        for (const key of Object.keys(record).sort()) {
            flatten(record[key], path ? `${path}.${key}` : key, output);
        }
        return;
    }
    output.set(path, value);
};

const canonicalFlatSnapshot = (snapshot: CanonicalTurnSnapshot): FlatSnapshot => {
    const { engine: _engine, watermarks: _watermarks, ...comparable } = snapshot;
    const output = new Map<string, unknown>();
    flatten(comparable, '', output);
    return output;
};

const flatValueAt = (snapshot: FlatSnapshot, path: string): unknown =>
    snapshot.has(path) ? snapshot.get(path) : flatMissing;

const publicFlatValue = (value: unknown): unknown => {
    if (value === flatArray) {
        return publicFlatStates.array;
    }
    if (value === flatObject) {
        return publicFlatStates.object;
    }
    if (value === flatMissing) {
        return publicFlatStates.missing;
    }
    return value;
};

const valuesEqual = (left: unknown, right: unknown, numericTolerance: number): boolean => {
    if (typeof left === 'number' && typeof right === 'number') {
        return Math.abs(left - right) <= numericTolerance;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }
        return left.every((value, index) => valuesEqual(value, right[index], numericTolerance));
    }
    if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
        const leftRecord = left as Record<string, unknown>;
        const rightRecord = right as Record<string, unknown>;
        const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
        return keys.every((key) => valuesEqual(leftRecord[key], rightRecord[key], numericTolerance));
    }
    return Object.is(left, right);
};

export const compareTurnSnapshots = (
    reference: CanonicalTurnSnapshot,
    core: CanonicalTurnSnapshot,
    options: SnapshotComparisonOptions = {}
): SnapshotDifference[] => {
    const ignored = options.ignoredPathPatterns ?? [];
    const tolerance = Math.max(0, options.numericTolerance ?? 0);
    const referenceFlat = canonicalFlatSnapshot(reference);
    const coreFlat = canonicalFlatSnapshot(core);
    const paths = [...new Set([...referenceFlat.keys(), ...coreFlat.keys()])].sort();
    return paths
        .filter((path) => !ignored.some((pattern) => pattern.test(path)))
        .filter((path) => !valuesEqual(flatValueAt(referenceFlat, path), flatValueAt(coreFlat, path), tolerance))
        .map((path) => ({
            path,
            reference: publicFlatValue(flatValueAt(referenceFlat, path)),
            core: publicFlatValue(flatValueAt(coreFlat, path)),
        }));
};

export const buildTurnSnapshotDelta = (
    before: CanonicalTurnSnapshot,
    after: CanonicalTurnSnapshot
): Map<string, unknown> => {
    const beforeFlat = canonicalFlatSnapshot(before);
    const afterFlat = canonicalFlatSnapshot(after);
    const paths = [...new Set([...beforeFlat.keys(), ...afterFlat.keys()])].sort();
    const delta = new Map<string, unknown>();
    for (const path of paths) {
        const previous = flatValueAt(beforeFlat, path);
        const next = flatValueAt(afterFlat, path);
        if (Object.is(previous, next)) {
            continue;
        }
        if (typeof previous === 'number' && typeof next === 'number') {
            delta.set(path, next - previous);
        } else {
            delta.set(path, { before: publicFlatValue(previous), after: publicFlatValue(next) });
        }
    }
    return delta;
};

export const compareTurnSnapshotDeltas = (
    referenceBefore: CanonicalTurnSnapshot,
    referenceAfter: CanonicalTurnSnapshot,
    coreBefore: CanonicalTurnSnapshot,
    coreAfter: CanonicalTurnSnapshot,
    options: SnapshotComparisonOptions = {}
): SnapshotDifference[] => {
    const ignored = options.ignoredPathPatterns ?? [];
    const tolerance = Math.max(0, options.numericTolerance ?? 0);
    const referenceDelta = buildTurnSnapshotDelta(referenceBefore, referenceAfter);
    const coreDelta = buildTurnSnapshotDelta(coreBefore, coreAfter);
    const paths = [...new Set([...referenceDelta.keys(), ...coreDelta.keys()])].sort();
    return paths
        .filter((path) => !ignored.some((pattern) => pattern.test(path)))
        .filter((path) => !valuesEqual(flatValueAt(referenceDelta, path), flatValueAt(coreDelta, path), tolerance))
        .map((path) => ({
            path,
            reference: publicFlatValue(flatValueAt(referenceDelta, path)),
            core: publicFlatValue(flatValueAt(coreDelta, path)),
        }));
};
