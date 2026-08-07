const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

/**
 * Reuses every unchanged branch from the current snapshot.
 *
 * tRPC returns a fresh object graph for every request. Assigning that graph
 * directly makes Vue notify consumers even when their slice did not change.
 * Structural sharing keeps that notification boundary aligned with actual
 * value changes without maintaining a field-by-field event routing table.
 */
export const structurallyShare = <T>(current: T, incoming: T): T => {
    if (Object.is(current, incoming)) {
        return current;
    }

    if (current instanceof Date && incoming instanceof Date) {
        return (current.getTime() === incoming.getTime() ? current : incoming) as T;
    }

    if (Array.isArray(current) && Array.isArray(incoming)) {
        if (current.length !== incoming.length) {
            return incoming;
        }
        let unchanged = true;
        const shared = incoming.map((value, index) => {
            const next = structurallyShare(current[index], value);
            unchanged &&= Object.is(next, current[index]);
            return next;
        });
        return (unchanged ? current : shared) as T;
    }

    if (isRecord(current) && isRecord(incoming)) {
        const currentKeys = Object.keys(current);
        const incomingKeys = Object.keys(incoming);
        if (currentKeys.length !== incomingKeys.length || currentKeys.some((key) => !(key in incoming))) {
            return incoming;
        }

        let unchanged = true;
        const shared: Record<string, unknown> = {};
        for (const key of incomingKeys) {
            const next = structurallyShare(current[key], incoming[key]);
            shared[key] = next;
            unchanged &&= Object.is(next, current[key]);
        }
        return (unchanged ? current : shared) as T;
    }

    return incoming;
};
