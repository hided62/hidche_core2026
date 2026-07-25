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

const entityKey = (value: Record<string, unknown>, index: number): string => {
    for (const key of ['id', 'generalId', 'nationId', 'fromNationId']) {
        const candidate = value[key];
        if (typeof candidate === 'number' || typeof candidate === 'string') {
            if (key === 'fromNationId' && value.toNationId !== undefined) {
                return `${String(candidate)}->${String(value.toNationId)}`;
            }
            if (value.turnIndex !== undefined) {
                return `${String(candidate)}:${String(value.officerLevel ?? '')}:${String(value.turnIndex)}`;
            }
            return String(candidate);
        }
    }
    return String(index);
};

const flatten = (value: unknown, path: string, output: FlatSnapshot): void => {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => {
            const key =
                path === 'logs' || path === 'messages'
                    ? String(index)
                    : typeof entry === 'object' && entry !== null && !Array.isArray(entry)
                      ? entityKey(entry as Record<string, unknown>, index)
                      : String(index);
            flatten(entry, `${path}[${key}]`, output);
        });
        return;
    }
    if (typeof value === 'object' && value !== null) {
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

const valuesEqual = (left: unknown, right: unknown, numericTolerance: number): boolean => {
    if (typeof left === 'number' && typeof right === 'number') {
        return Math.abs(left - right) <= numericTolerance;
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
        .filter((path) => !valuesEqual(referenceFlat.get(path), coreFlat.get(path), tolerance))
        .map((path) => ({
            path,
            reference: referenceFlat.get(path),
            core: coreFlat.get(path),
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
        const previous = beforeFlat.get(path);
        const next = afterFlat.get(path);
        if (Object.is(previous, next)) {
            continue;
        }
        if (typeof previous === 'number' && typeof next === 'number') {
            delta.set(path, next - previous);
        } else {
            delta.set(path, { before: previous, after: next });
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
        .filter((path) => !valuesEqual(referenceDelta.get(path), coreDelta.get(path), tolerance))
        .map((path) => ({
            path,
            reference: referenceDelta.get(path),
            core: coreDelta.get(path),
        }));
};
