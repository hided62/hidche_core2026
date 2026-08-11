import { applyPatch, createPatch, type Operation } from 'rfc6902';

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

export interface AppliedReadModelDelta<T> {
    data: T;
    revision: string;
}

const cloneJsonValue = <T>(value: T): T => structuredClone(value);

export const createJsonPatch = (current: unknown, next: unknown): JsonPatchOperation[] => createPatch(current, next);

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

    const next = cloneJsonValue(current);
    const errors = applyPatch(next, delta.operations as Operation[]);
    const failure = errors.find((error) => error !== null);
    if (failure) {
        throw new ReadModelDeltaMismatchError(`JSON Patch application failed: ${failure.message}`);
    }

    return {
        data: next,
        revision: delta.revision,
    };
};
