import { describe, expect, it } from 'vitest';

import { applyReadModelDelta } from '@sammo-ts/common';

import {
    buildReadModelDeltaCacheKey,
    createReadModelDelta,
    type ReadModelDeltaCacheStore,
} from '../src/services/readModelDeltaCache.js';

class MemoryStore implements ReadModelDeltaCacheStore {
    readonly values = new Map<string, string>();
    setCalls = 0;

    async get(key: string): Promise<string | null> {
        return this.values.get(key) ?? null;
    }

    async set(key: string, value: string): Promise<string> {
        this.setCalls += 1;
        this.values.set(key, value);
        return 'OK';
    }
}

const largeCommandTable = () => ({
    general: Array.from({ length: 48 }, (_, index) => ({
        key: `command-${index}`,
        name: `명령 ${index}`,
        reqArg: index % 2 === 0,
        possible: true,
        status: 'available',
        inputFields: [{ key: 'amount', label: '수량', type: 'number' }],
    })),
    nation: [],
    inputOptions: {
        cities: Array.from({ length: 20 }, (_, index) => ({ value: index + 1, label: `도시 ${index + 1}` })),
    },
});

describe('createReadModelDelta', () => {
    it('reduces unchanged and one-field updates below one kilobyte', async () => {
        const store = new MemoryStore();
        const initialValue = largeCommandTable();
        const initial = await createReadModelDelta({
            store,
            profile: 'hwe:default',
            viewerId: 'user-1',
            slice: 'command-table',
            value: initialValue,
            forceSnapshot: true,
        });
        expect(initial.kind).toBe('snapshot');
        expect(Buffer.byteLength(JSON.stringify(initial))).toBeGreaterThan(5_000);

        const unchanged = await createReadModelDelta({
            store,
            profile: 'hwe:default',
            viewerId: 'user-1',
            slice: 'command-table',
            value: initialValue,
            knownRevision: initial.revision,
        });
        expect(unchanged.kind).toBe('unchanged');
        expect(Buffer.byteLength(JSON.stringify(unchanged))).toBeLessThan(1_000);
        expect(store.setCalls).toBe(1);

        const nextValue = structuredClone(initialValue);
        const firstCommand = nextValue.general[0];
        if (!firstCommand) throw new Error('command fixture is empty');
        firstCommand.possible = false;
        firstCommand.status = 'blocked';
        const changed = await createReadModelDelta({
            store,
            profile: 'hwe:default',
            viewerId: 'user-1',
            slice: 'command-table',
            value: nextValue,
            knownRevision: initial.revision,
        });
        expect(changed.kind).toBe('patch');
        expect(Buffer.byteLength(JSON.stringify(changed))).toBeLessThan(1_000);
        expect(applyReadModelDelta(initialValue, initial.revision, changed).data).toEqual(nextValue);
    });

    it('keeps private baselines in viewer-scoped keys', () => {
        expect(buildReadModelDeltaCacheKey('hwe:default', 'user-1', 'context', 'revision')).not.toBe(
            buildReadModelDeltaCacheKey('hwe:default', 'user-2', 'context', 'revision')
        );
    });

    it('keeps the snapshot fallback when a positional patch is larger', async () => {
        const store = new MemoryStore();
        const initialValue = { values: Array.from({ length: 24 }, () => 'old') };
        const initial = await createReadModelDelta({
            store,
            profile: 'hwe:default',
            viewerId: 'user-1',
            slice: 'context',
            value: initialValue,
            forceSnapshot: true,
        });
        const nextValue = { values: Array.from({ length: 24 }, () => 'new') };

        const changed = await createReadModelDelta({
            store,
            profile: 'hwe:default',
            viewerId: 'user-1',
            slice: 'context',
            value: nextValue,
            knownRevision: initial.revision,
        });

        expect(changed).toMatchObject({ kind: 'snapshot', data: nextValue });
    });

    it('falls back to a snapshot when Redis is unavailable', async () => {
        const store: ReadModelDeltaCacheStore = {
            get: async () => {
                throw new Error('redis unavailable');
            },
            set: async () => {
                throw new Error('redis unavailable');
            },
        };
        const delta = await createReadModelDelta({
            store,
            profile: 'hwe:default',
            viewerId: 'user-1',
            slice: 'context',
            value: { general: { id: 1 } },
            knownRevision: 'old-revision',
        });

        expect(delta).toMatchObject({ kind: 'snapshot', data: { general: { id: 1 } } });
    });
});
