import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { RuntimeNavigationConfigStore } from '../src/navigation/runtimeNavigationConfig.js';
import {
    matchesIfNoneMatch,
    registerRuntimeNavigationRoute,
    runtimeNavigationCacheControl,
} from '../src/navigation/runtimeNavigationRoute.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

const createStore = async (): Promise<{
    store: RuntimeNavigationConfigStore;
    overridePath: string;
    raw: { gateway: { items: Array<{ label: string }> } };
}> => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-navigation-route-'));
    temporaryDirectories.push(directory);
    const overridePath = path.join(directory, 'navigation.json');
    const defaultPath = path.resolve(import.meta.dirname, '../../../resources/navigation.json');
    const raw = JSON.parse(await fs.readFile(defaultPath, 'utf8')) as {
        gateway: { items: Array<{ label: string }> };
    };
    await fs.writeFile(overridePath, JSON.stringify(raw));
    return { store: new RuntimeNavigationConfigStore(overridePath, defaultPath), overridePath, raw };
};

describe('runtime navigation HTTP cache', () => {
    it('한 시간 fresh cache와 content ETag를 제공한다', async () => {
        const { store } = await createStore();
        const app = fastify();
        registerRuntimeNavigationRoute(app, store);

        const response = await app.inject({ method: 'GET', url: '/navigation' });

        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe(runtimeNavigationCacheControl);
        expect(response.headers.etag).toMatch(/^"[a-f0-9]{64}"$/u);
        expect(response.json<{ gateway: { items: Array<{ label: string }> } }>().gateway.items[0]?.label).toBe(
            '공지사항'
        );
        await app.close();
    });

    it('freshness 만료 후 같은 ETag이면 본문 없이 304를 반환한다', async () => {
        const { store } = await createStore();
        const app = fastify();
        registerRuntimeNavigationRoute(app, store);
        const first = await app.inject({ method: 'GET', url: '/navigation' });

        const response = await app.inject({
            method: 'GET',
            url: '/navigation',
            headers: { 'if-none-match': `"other", W/${first.headers.etag}` },
        });

        expect(response.statusCode).toBe(304);
        expect(response.body).toBe('');
        expect(response.headers['cache-control']).toBe(runtimeNavigationCacheControl);
        expect(response.headers.etag).toBe(first.headers.etag);
        await app.close();
    });

    it('운영 JSON 내용이 바뀌면 새 ETag와 본문을 반환한다', async () => {
        const { store, overridePath, raw } = await createStore();
        const app = fastify();
        registerRuntimeNavigationRoute(app, store);
        const first = await app.inject({ method: 'GET', url: '/navigation' });
        raw.gateway.items[0]!.label = '운영 공지';
        await fs.writeFile(overridePath, JSON.stringify(raw));

        const response = await app.inject({
            method: 'GET',
            url: '/navigation',
            headers: { 'if-none-match': first.headers.etag },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers.etag).not.toBe(first.headers.etag);
        expect(response.json<{ gateway: { items: Array<{ label: string }> } }>().gateway.items[0]?.label).toBe(
            '운영 공지'
        );
        await app.close();
    });
});

describe('matchesIfNoneMatch', () => {
    it('wildcard와 weak validator를 GET 비교에서 허용한다', () => {
        expect(matchesIfNoneMatch('*', '"etag"')).toBe(true);
        expect(matchesIfNoneMatch('W/"etag"', '"etag"')).toBe(true);
        expect(matchesIfNoneMatch('"other"', '"etag"')).toBe(false);
    });
});
