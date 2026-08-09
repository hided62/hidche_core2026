export const gatewayFastifyRouterOptions = {
    // tRPC joins batched procedure names in a single route parameter. Fastify's
    // default limit is 100 characters, which is shorter than normal admin-page
    // startup batches such as capabilities + profiles + release state.
    maxParamLength: 2_048,
} as const;
