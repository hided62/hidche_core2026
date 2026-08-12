import { applyPatch, type Operation } from 'rfc6902';

export interface JsonPatchOperation {
    op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
    path: string;
    from?: string;
    value?: unknown;
}

export type ReadModelDelta<T> =
    | {
          kind: 'snapshot';
          revision: string;
          data: T;
      }
    | {
          kind: 'unchanged';
          revision: string;
      }
    | {
          kind: 'patch';
          baseRevision: string;
          revision: string;
          operations: JsonPatchOperation[];
      };

export class ReadModelDeltaMismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ReadModelDeltaMismatchError';
    }
}

export class ReadModelDeltaApplyError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'ReadModelDeltaApplyError';
    }
}

export interface AppliedReadModelDelta<T> {
    data: T;
    revision: string;
}

/**
 * Read-model deltas operate on JSON documents received over tRPC. Serializing
 * through JSON also unwraps Vue's nested reactive proxies, which a root-level
 * `toRaw()` does not remove and `structuredClone()` cannot clone.
 */
export const cloneReadModelJson = <T>(value: T): T => {
    try {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) {
            throw new TypeError('The read-model value is not a JSON document.');
        }
        return JSON.parse(serialized) as T;
    } catch (error) {
        if (error instanceof ReadModelDeltaApplyError) {
            throw error;
        }
        throw new ReadModelDeltaApplyError('Failed to clone the read-model JSON document.', { cause: error });
    }
};

const escapeJsonPointerToken = (token: string): string => token.replaceAll('~', '~0').replaceAll('/', '~1');

const appendJsonPointer = (path: string, token: string): string => `${path}/${escapeJsonPointerToken(token)}`;

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Build a valid patch in one positional pass over arrays.
 *
 * The upstream rfc6902 generator minimizes array edit count with a Levenshtein
 * matrix. Dashboard read models use stable, positional arrays and only need an
 * exact reconstruction; the cache layer already rejects patches larger than a
 * snapshot. Positional recursion is therefore linear: shifted positions are
 * reconciled once, then excess tail items are removed or appended.
 */
const appendLinearJsonDiff = (
    operations: JsonPatchOperation[],
    current: unknown,
    next: unknown,
    path: string
): void => {
    if (Object.is(current, next)) {
        return;
    }

    if (Array.isArray(current) && Array.isArray(next)) {
        const sharedLength = Math.min(current.length, next.length);
        for (let index = 0; index < sharedLength; index += 1) {
            appendLinearJsonDiff(operations, current[index], next[index], appendJsonPointer(path, String(index)));
        }
        for (let index = current.length - 1; index >= next.length; index -= 1) {
            operations.push({ op: 'remove', path: appendJsonPointer(path, String(index)) });
        }
        for (let index = current.length; index < next.length; index += 1) {
            operations.push({ op: 'add', path: appendJsonPointer(path, '-'), value: next[index] });
        }
        return;
    }

    if (isJsonObject(current) && isJsonObject(next)) {
        const currentKeys = Object.keys(current).filter((key) => current[key] !== undefined);
        const nextKeys = Object.keys(next).filter((key) => next[key] !== undefined);
        const nextKeySet = new Set(nextKeys);
        const currentKeySet = new Set(currentKeys);

        for (const key of currentKeys) {
            if (!nextKeySet.has(key)) {
                operations.push({ op: 'remove', path: appendJsonPointer(path, key) });
            }
        }
        for (const key of nextKeys) {
            const itemPath = appendJsonPointer(path, key);
            if (!currentKeySet.has(key)) {
                operations.push({ op: 'add', path: itemPath, value: next[key] });
                continue;
            }
            appendLinearJsonDiff(operations, current[key], next[key], itemPath);
        }
        return;
    }

    operations.push({ op: 'replace', path, value: next });
};

export const createJsonPatch = (current: unknown, next: unknown): JsonPatchOperation[] => {
    const operations: JsonPatchOperation[] = [];
    appendLinearJsonDiff(operations, current, next, '');
    return operations;
};

export const applyReadModelDelta = <T>(
    current: T | undefined,
    currentRevision: string | null,
    delta: ReadModelDelta<T>
): AppliedReadModelDelta<T> => {
    if (delta.kind === 'snapshot') {
        return {
            data: delta.data,
            revision: delta.revision,
        };
    }

    if (current === undefined || currentRevision === null) {
        throw new ReadModelDeltaMismatchError('A delta cannot be applied before the initial snapshot.');
    }

    if (delta.kind === 'unchanged') {
        if (currentRevision !== delta.revision) {
            throw new ReadModelDeltaMismatchError(
                `Unchanged revision mismatch: have ${currentRevision}, received ${delta.revision}.`
            );
        }
        return {
            data: current,
            revision: currentRevision,
        };
    }

    if (currentRevision !== delta.baseRevision) {
        throw new ReadModelDeltaMismatchError(
            `Patch base revision mismatch: have ${currentRevision}, expected ${delta.baseRevision}.`
        );
    }

    const next = cloneReadModelJson(current);
    try {
        const errors = applyPatch(next, delta.operations as Operation[]);
        const failure = errors.find((error) => error !== null);
        if (failure) {
            throw new ReadModelDeltaApplyError(`JSON Patch application failed: ${failure.message}`);
        }
    } catch (error) {
        if (error instanceof ReadModelDeltaApplyError) {
            throw error;
        }
        throw new ReadModelDeltaApplyError('JSON Patch application failed.', { cause: error });
    }

    return {
        data: next,
        revision: delta.revision,
    };
};
