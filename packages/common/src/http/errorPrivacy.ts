/** Preserve public validation/permission messages while hiding internal causes and stacks. */
export const safeTrpcErrorFormatter = <T extends { message: string; data: { code: string; stack?: string } }>({
    shape,
}: {
    shape: T;
}): T => ({
    ...shape,
    message: shape.data.code === 'INTERNAL_SERVER_ERROR' ? 'Internal server error' : shape.message,
    data: { ...shape.data, stack: undefined },
});

export const safeHttpErrorHandler = (
    error: unknown,
    request: { log: { error: (context: object, message: string) => void } },
    reply: { code: (status: number) => { send: (body: object) => unknown } }
): void => {
    const value = error && typeof error === 'object' ? (error as { statusCode?: number; message?: string }) : {};
    const status =
        typeof value.statusCode === 'number' &&
        Number.isInteger(value.statusCode) &&
        value.statusCode >= 400 &&
        value.statusCode < 500
            ? value.statusCode
            : 500;
    request.log.error({ err: error }, 'Request handling failed');
    reply.code(status).send({
        statusCode: status,
        error: status >= 500 ? 'Internal Server Error' : 'Request Error',
        message: status >= 500 ? 'Internal server error' : (value.message ?? 'Request failed'),
    });
};
