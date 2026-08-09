import fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { gatewayFastifyRouterOptions } from '../src/fastifyOptions.js';

const apps = new Set<ReturnType<typeof fastify>>();

afterEach(async () => {
    await Promise.allSettled(Array.from(apps, (app) => app.close()));
    apps.clear();
});

describe('Gateway Fastify routing', () => {
    it('accepts the admin release page initial tRPC batch path', async () => {
        const app = fastify({
            logger: false,
            routerOptions: gatewayFastifyRouterOptions,
        });
        apps.add(app);
        app.get('/gateway/api/trpc/:path', async (request) => request.params);

        const batchPath = [
            'admin.capabilities.list',
            'admin.profiles.list',
            'admin.capabilities.list',
            'admin.releases.gatewayState',
            'admin.releases.list',
        ].join(',');
        expect(batchPath.length).toBeGreaterThan(100);

        const response = await app.inject({
            method: 'GET',
            url: `/gateway/api/trpc/${batchPath}?batch=1`,
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ path: batchPath });
    });
});
