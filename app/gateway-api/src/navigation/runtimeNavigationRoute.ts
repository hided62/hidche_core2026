import type { FastifyInstance } from 'fastify';

import type { RuntimeNavigationConfigStore } from './runtimeNavigationConfig.js';

export const runtimeNavigationCacheControl = 'public, max-age=3600, must-revalidate';

export const matchesIfNoneMatch = (header: string | undefined, etag: string): boolean => {
    if (!header) return false;
    return header.split(',').some((candidate) => {
        const value = candidate.trim();
        return value === '*' || value.replace(/^W\//u, '') === etag;
    });
};

export const registerRuntimeNavigationRoute = (
    app: FastifyInstance,
    navigationConfig: RuntimeNavigationConfigStore
): void => {
    app.get('/navigation', async (request, reply) => {
        const current = await navigationConfig.getWithEtag();
        void reply.header('Cache-Control', runtimeNavigationCacheControl);
        void reply.header('ETag', current.etag);
        if (matchesIfNoneMatch(request.headers['if-none-match'], current.etag)) {
            return reply.code(304).send();
        }
        return current.config;
    });
};
