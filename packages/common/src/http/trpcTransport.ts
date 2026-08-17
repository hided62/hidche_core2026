/**
 * tRPC keeps procedure semantics in its envelope, so browser inputs belong in a JSON body
 * instead of a percent-encoded URL query string.
 */
export const trpcJsonBodyHttpClientOptions = {
    methodOverride: 'POST',
} as const;

/** POST may execute queries, while tRPC still rejects mutations sent as GET. */
export const trpcJsonBodyHttpServerOptions = {
    allowMethodOverride: true,
} as const;
