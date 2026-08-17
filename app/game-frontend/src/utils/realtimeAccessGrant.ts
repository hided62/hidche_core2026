export const REALTIME_ACCESS_GRANT_CONTEXT_KEY = 'realtimeAccessGrant';

export const createRealtimeRequestOptions = (refreshGrant: string | null | undefined) =>
    refreshGrant
        ? {
              context: {
                  [REALTIME_ACCESS_GRANT_CONTEXT_KEY]: refreshGrant,
              },
          }
        : undefined;

export const resolveBatchRealtimeAccessGrant = (
    operations: ReadonlyArray<{ context: Record<string, unknown> }>
): string | undefined => {
    if (operations.length === 0) return undefined;
    const first = operations[0]?.context[REALTIME_ACCESS_GRANT_CONTEXT_KEY];
    if (typeof first !== 'string' || first.length === 0) return undefined;
    return operations.every((operation) => operation.context[REALTIME_ACCESS_GRANT_CONTEXT_KEY] === first)
        ? first
        : undefined;
};
