const MAX_ORIGINS = 32;
const MAX_ORIGIN_LENGTH = 2048;

const parsePublicUrl = (value: string): URL => {
    if (value.length > MAX_ORIGIN_LENGTH) throw new Error('API origin configuration is too long.');
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('API origins require a public HTTP(S) URL without credentials.');
    }
    return url;
};

/** Public application URLs supply the default origins; extra origins must be explicit. */
export const resolveApiAllowedOrigins = (
    extraOrigins: string | undefined,
    publicUrls: readonly (string | undefined)[]
): string[] => {
    const origins = new Set<string>();
    for (const value of publicUrls) {
        if (value?.trim()) origins.add(parsePublicUrl(value.trim()).origin);
    }
    if (extraOrigins?.trim()) {
        const entries = extraOrigins.split(',');
        if (entries.length > MAX_ORIGINS) throw new Error('Too many API allowed origins.');
        for (const value of entries) {
            const url = parsePublicUrl(value.trim());
            if (url.pathname !== '/' || url.search || url.hash) {
                throw new Error('API_ALLOWED_ORIGINS entries must be origins, without paths or queries.');
            }
            origins.add(url.origin);
        }
    }
    if (origins.size > MAX_ORIGINS) throw new Error('Too many API allowed origins.');
    return [...origins];
};

class ApiOriginForbiddenError extends Error {
    readonly statusCode = 403;

    constructor() {
        super('Request origin is not allowed.');
    }
}

/** Reject browser requests before parsing bodies or dispatching mutations, not just CORS responses. */
export const createApiOriginGuard = (allowedOrigins: readonly string[]) => {
    const allowed = new Set(allowedOrigins);
    return async (request: { headers: { origin?: string | string[] } }): Promise<void> => {
        const origin = request.headers.origin;
        // Internal machine clients have no Origin and still require their ordinary auth/HMAC.
        if (origin === undefined) return;
        if (typeof origin !== 'string' || origin.length > MAX_ORIGIN_LENGTH || !allowed.has(origin)) {
            throw new ApiOriginForbiddenError();
        }
    };
};
