import { describe, expect, it, vi } from 'vitest';

import type { GameApiContext } from '../src/context.js';
import { loadWorldMap, buildRevisionedBaseMapCacheKey } from '../src/maps/worldMap.js';
import { readMapWorldSourceRevision } from '../src/maps/worldMapSourceRevision.js';

const revisionRow = (overrides: Record<string, unknown> = {}) => ({
    coverageVersion: 1,
    revision: 12n,
    ...overrides,
});

describe('world map revision cache', () => {
    it('keys shared base and public maps from the authoritative PostgreSQL map.world head', async () => {
        const queryRaw = vi.fn(async (_query: unknown) => [revisionRow()]);
        const ctx = {
            profile: { id: 'hwe', name: 'hwe:default', scenario: 'scenario_2400' },
            db: { $queryRaw: queryRaw },
        } as unknown as GameApiContext;

        await expect(buildRevisionedBaseMapCacheKey(ctx)).resolves.toBe(
            'sammo:map:base:hwe:scenario_2400:pg12'
        );
        await expect(buildRevisionedBaseMapCacheKey(ctx, 'public')).resolves.toBe(
            'sammo:map:public:hwe:scenario_2400:pg12'
        );
        expect(queryRaw).toHaveBeenCalledTimes(2);
        const statement = queryRaw.mock.calls[0]?.[0] as { sql: string; values: unknown[] };
        expect(statement.sql).toContain('read_model_revision_meta');
        expect(statement.sql).toContain("revision.\"domain\" = 'map.world'");
        expect(statement.values).toEqual([]);
    });

    it('disables shared caching for coverage zero, missing rows, malformed results, and query errors', async () => {
        for (const rows of [
            [revisionRow({ coverageVersion: 0 })],
            [revisionRow({ revision: null })],
            [revisionRow({ revision: 'bad' })],
            [],
        ]) {
            await expect(
                readMapWorldSourceRevision({ $queryRaw: vi.fn(async (_query: unknown) => rows) } as never)
            ).resolves.toBeNull();
        }
        await expect(
            readMapWorldSourceRevision({
                $queryRaw: vi.fn(async (_query: unknown) => Promise.reject(new Error('db unavailable'))),
            } as never)
        ).resolves.toBeNull();
    });

    it('caches only the public base while composing viewer-private fields per request', async () => {
        const cache = new Map<string, string>();
        const redis = {
            get: vi.fn(async (key: string) => cache.get(key) ?? null),
            set: vi.fn(async (key: string, value: string) => {
                cache.set(key, value);
                return 'OK';
            }),
        };
        const worldState = {
            currentYear: 185,
            currentMonth: 4,
            config: { const: {} },
            meta: { scenarioMeta: { startYear: 184 } },
        };
        const generals = new Map([
            [7, { id: 7, cityId: 3, nationId: 2 }],
            [8, { id: 8, cityId: 4, nationId: 3 }],
        ]);
        const nations = new Map([
            [2, { id: 2, meta: { spyList: { 5: 9 } } }],
            [3, { id: 3, meta: { spyList: { 6: 8 } } }],
        ]);
        const queryRaw = vi.fn(async (statement: { sql?: string }) => {
            const sql = statement.sql ?? '';
            if (sql.includes('read_model_revision_meta')) return [revisionRow()];
            if (sql.includes('FROM city')) {
                return [{ id: 3, level: 1, nationId: 2, region: 1, supplyState: 1, meta: { state: 0 } }];
            }
            if (sql.includes('FROM nation')) {
                return [{ id: 2, name: '위', color: '#123456', capitalCityId: 3, meta: {} }];
            }
            if (sql.includes('SELECT DISTINCT city_id')) return [{ cityId: 3 }];
            return [];
        });
        const ctx = {
            profile: { id: 'hwe', name: 'hwe:default', scenario: 'scenario_2400' },
            redis,
            db: {
                $queryRaw: queryRaw,
                worldState: { findFirst: vi.fn(async () => worldState) },
                general: { findUnique: vi.fn(async ({ where }: { where: { id: number } }) => generals.get(where.id)) },
                nation: { findUnique: vi.fn(async ({ where }: { where: { id: number } }) => nations.get(where.id)) },
            },
        } as unknown as GameApiContext;

        const first = await loadWorldMap(ctx, { generalId: 7, useCache: true });
        const second = await loadWorldMap(ctx, { generalId: 8, useCache: true });

        expect(first).toMatchObject({ myCity: 3, myNation: 2, spyList: { 5: 9 } });
        expect(second).toMatchObject({ myCity: 4, myNation: 3, spyList: { 6: 8 } });
        expect(redis.set).toHaveBeenCalledTimes(1);
        const shared = JSON.parse(cache.values().next().value as string) as Record<string, unknown>;
        expect(shared).not.toHaveProperty('spyList');
        expect(shared).not.toHaveProperty('shownByGeneralList');
        expect(shared).not.toHaveProperty('myCity');
        expect(shared).not.toHaveProperty('myNation');
    });

    it('does not read or write Redis when PostgreSQL revision authority is unavailable', async () => {
        const redis = { get: vi.fn(), set: vi.fn() };
        const queryRaw = vi.fn(async (statement: { sql?: string }) => {
            const sql = statement.sql ?? '';
            if (sql.includes('read_model_revision_meta')) return [revisionRow({ coverageVersion: 0 })];
            if (sql.includes('FROM city') || sql.includes('FROM nation')) return [];
            return [];
        });
        const ctx = {
            profile: { id: 'hwe', name: 'hwe:default', scenario: 'scenario_2400' },
            redis,
            db: {
                $queryRaw: queryRaw,
                worldState: { findFirst: vi.fn(async () => ({ currentYear: 185, currentMonth: 1, config: {}, meta: {} })) },
            },
        } as unknown as GameApiContext;

        await expect(loadWorldMap(ctx, { useCache: true })).resolves.toMatchObject({ result: true });
        expect(redis.get).not.toHaveBeenCalled();
        expect(redis.set).not.toHaveBeenCalled();
    });
});
