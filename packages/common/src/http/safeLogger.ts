const errorCodes = /^(?:P\d{4}|FST_ERR_[A-Z_]+|ERR_[A-Z_]+|UNAUTHORIZED|FORBIDDEN|BAD_REQUEST|INTERNAL_SERVER_ERROR)$/;

const errorSummary = (
    error: unknown
): { type: string; message: string; stack: string; code?: string; statusCode?: number } => {
    const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
    const code =
        typeof value.code === 'string' && value.code.length < 80 && errorCodes.test(value.code)
            ? value.code
            : undefined;
    const statusCode =
        typeof value.statusCode === 'number' && value.statusCode >= 400 && value.statusCode <= 599
            ? value.statusCode
            : undefined;
    return {
        type: 'RequestError',
        message: 'Request handling failed',
        stack: '',
        ...(code ? { code } : {}),
        ...(statusCode ? { statusCode } : {}),
    };
};

/** HTTP diagnostics carry static route/status/code, never credentials or error payloads. */
export const safeHttpLoggerOptions = {
    serializers: {
        req: (request: { method?: string; routeOptions?: { url?: string } }) => ({
            method: request.method,
            // URLs can carry OAuth/session/input values, including unmatched path segments.
            url: request.routeOptions?.url ?? '[unmatched]',
        }),
        res: (response: { statusCode?: number }) => ({ statusCode: response.statusCode }),
        err: errorSummary,
    },
    redact: {
        paths: [
            'authorization',
            'cookie',
            'password',
            'sessionToken',
            'accessToken',
            'token',
            'secret',
            'body',
            'headers',
            'req.headers',
            'req.body',
            'res.headers',
        ],
        remove: true,
    },
    hooks: {
        logMethod(args: unknown[], method: (...values: unknown[]) => void): void {
            const first = args[0];
            const error =
                first instanceof Error
                    ? first
                    : first && typeof first === 'object' && 'err' in first
                      ? first.err
                      : undefined;
            if (error !== undefined) {
                // Fastify also copies err.message into msg; serializers alone do not protect it.
                method.apply(this, [{ err: errorSummary(error) }, 'Request handling failed']);
            } else {
                // Fastify's default 404 handler also embeds the raw URL in a message.
                method.apply(
                    this,
                    args.map((value) =>
                        typeof value === 'string' && /^Route .+ not found$/.test(value) ? 'Route not found' : value
                    )
                );
            }
        },
    },
};
