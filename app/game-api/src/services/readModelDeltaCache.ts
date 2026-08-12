import { createHash } from 'node:crypto';
import { createJsonPatch, type ReadModelDelta } from '@sammo-ts/common';

const CACHE_TTL_SECONDS = 15 * 60;
const REVISION_LENGTH = 22;

export interface ReadModelDeltaCacheStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options: { EX: number }): Promise<unknown>;
}

export interface ReadModelDeltaRequest<T> {
    store: ReadModelDeltaCacheStore;
    profile: string;
    viewerId: string;
    slice: string;
    value: T;
    knownRevision?: string;
    forceSnapshot?: boolean;
}

const canonicalize = (value: unknown): unknown => {
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, canonicalize(item)])
        );
    }
    return value;
};

const digest = (value: string): string =>
    createHash('sha256').update(value).digest('base64url').slice(0, REVISION_LENGTH);

const buildScope = (profile: string, viewerId: string, slice: string): string =>
    digest(`${profile}\0${viewerId}\0${slice}`);

export const buildReadModelDeltaCacheKey = (
    profile: string,
    viewerId: string,
    slice: string,
    revision: string
): string => `sammo:${profile}:private-read-model:${buildScope(profile, viewerId, slice)}:${revision}`;

const canPatch = (value: unknown): value is Record<string, unknown> | unknown[] =>
    value !== null && typeof value === 'object';

const snapshotByteLength = (revision: string, serialized: string): number =>
    Buffer.byteLength(`{"kind":"snapshot","revision":${JSON.stringify(revision)},"data":`) +
    Buffer.byteLength(serialized) +
    1;

const storeSnapshot = async (store: ReadModelDeltaCacheStore, key: string, serialized: string): Promise<void> => {
    try {
        await store.set(key, serialized, { EX: CACHE_TTL_SECONDS });
    } catch {
        // Redis is a best-effort optimization. The caller still receives a full snapshot.
    }
};

export const createReadModelDelta = async <T>(request: ReadModelDeltaRequest<T>): Promise<ReadModelDelta<T>> => {
    const canonicalValue = canonicalize(request.value) as T;
    const serialized = JSON.stringify(canonicalValue);
    const revision = digest(serialized);
    const currentKey = buildReadModelDeltaCacheKey(request.profile, request.viewerId, request.slice, revision);

    if (!request.forceSnapshot && request.knownRevision === revision) {
        return { kind: 'unchanged', revision };
    }

    if (!request.forceSnapshot && request.knownRevision) {
        const baselineKey = buildReadModelDeltaCacheKey(
            request.profile,
            request.viewerId,
            request.slice,
            request.knownRevision
        );
        try {
            const baselineSerialized = await request.store.get(baselineKey);
            if (baselineSerialized) {
                const baseline = JSON.parse(baselineSerialized) as unknown;
                if (canPatch(baseline) && canPatch(canonicalValue)) {
                    const operations = createJsonPatch(baseline, canonicalValue);
                    const patch = {
                        kind: 'patch' as const,
                        baseRevision: request.knownRevision,
                        revision,
                        operations,
                    };
                    const snapshot = { kind: 'snapshot' as const, revision, data: canonicalValue };
                    await storeSnapshot(request.store, currentKey, serialized);
                    return Buffer.byteLength(JSON.stringify(patch)) < snapshotByteLength(revision, serialized)
                        ? patch
                        : snapshot;
                }
            }
        } catch {
            // Corrupt/missing cache data and Redis failures recover with a full snapshot.
        }
    }

    await storeSnapshot(request.store, currentKey, serialized);
    return {
        kind: 'snapshot',
        revision,
        data: canonicalValue,
    };
};
