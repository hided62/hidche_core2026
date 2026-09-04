export const READ_MODEL_DOMAINS = [
    'general.content',
    'city.content',
    'nation.content',
    'dashboard.global',
    'world.content',
    'map.world',
    'map.general',
    'records.general',
    'records.global',
    'records.history',
    'front.general',
    'front.nation',
    'front.global',
    'access.general',
    'lobby.world',
    'lobby.general',
    'contacts.world',
    'reserved.general',
    'messages.mailbox',
    'messages.diplomacyMailbox',
    'tournament',
    'betting',
] as const;

export type ReadModelDomain = (typeof READ_MODEL_DOMAINS)[number];

export interface ReadModelRevisionKey {
    domain: ReadModelDomain;
    entityId: number;
}

export interface CommittedReadModelRevision extends ReadModelRevisionKey {
    revision: bigint;
}

/**
 * Internal, post-commit invalidation contract. Entity IDs and durable
 * revisions are intentionally retained here for server-side projection and
 * viewer filtering; this value must not cross the public SSE boundary.
 */
export interface CommittedReadModelInvalidation {
    revisions: readonly CommittedReadModelRevision[];
}

export const READ_MODEL_OUTBOX_PAYLOAD_VERSION = 1 as const;

export type ReadModelOutboxChange = readonly [domain: ReadModelDomain, entityId: number, revision: string];

export interface ReadModelOutboxPayloadV1 {
    version: typeof READ_MODEL_OUTBOX_PAYLOAD_VERSION;
    changes: readonly ReadModelOutboxChange[];
}

const READ_MODEL_DOMAIN_SET: ReadonlySet<string> = new Set(READ_MODEL_DOMAINS);

export const isReadModelDomain = (value: string): value is ReadModelDomain => READ_MODEL_DOMAIN_SET.has(value);

const assertRevisionKey = (key: ReadModelRevisionKey): void => {
    if (!isReadModelDomain(key.domain)) {
        throw new TypeError(`Unknown read-model domain: ${String(key.domain)}`);
    }
    if (!Number.isSafeInteger(key.entityId) || key.entityId < 0) {
        throw new RangeError(`Read-model entity ID must be a non-negative safe integer: ${String(key.entityId)}`);
    }
};

const compareRevisionKeys = (left: ReadModelRevisionKey, right: ReadModelRevisionKey): number => {
    const domainOrder = left.domain < right.domain ? -1 : left.domain > right.domain ? 1 : 0;
    return domainOrder === 0 ? left.entityId - right.entityId : domainOrder;
};

/**
 * Dedupe and sort keys before acquiring revision row locks. Stable lock order
 * is part of the transaction contract for concurrent writers.
 */
export const normalizeReadModelRevisionKeys = (
    keys: Iterable<ReadModelRevisionKey>
): readonly ReadModelRevisionKey[] => {
    const byDomain = new Map<ReadModelDomain, Set<number>>();
    for (const key of keys) {
        assertRevisionKey(key);
        const entityIds = byDomain.get(key.domain) ?? new Set<number>();
        entityIds.add(key.entityId);
        byDomain.set(key.domain, entityIds);
    }

    const normalized: ReadModelRevisionKey[] = [];
    for (const [domain, entityIds] of byDomain) {
        for (const entityId of entityIds) {
            normalized.push({ domain, entityId });
        }
    }
    return normalized.sort(compareRevisionKeys);
};

export const createReadModelOutboxPayload = (
    invalidation: CommittedReadModelInvalidation
): ReadModelOutboxPayloadV1 => ({
    version: READ_MODEL_OUTBOX_PAYLOAD_VERSION,
    changes: [...invalidation.revisions]
        .sort(compareRevisionKeys)
        .map(({ domain, entityId, revision }) => [domain, entityId, revision.toString()] as const),
});

/** Mutable transaction-local collector. It has no I/O and exposes snapshots. */
export class ChangeJournal {
    readonly #keys = new Map<ReadModelDomain, Set<number>>();

    mark(domain: ReadModelDomain, entityId = 0): this {
        return this.markKey({ domain, entityId });
    }

    markKey(key: ReadModelRevisionKey): this {
        assertRevisionKey(key);
        const entityIds = this.#keys.get(key.domain) ?? new Set<number>();
        entityIds.add(key.entityId);
        this.#keys.set(key.domain, entityIds);
        return this;
    }

    markAll(keys: Iterable<ReadModelRevisionKey>): this {
        for (const key of keys) {
            this.markKey(key);
        }
        return this;
    }

    merge(other: ChangeJournal): this {
        return this.markAll(other.snapshot());
    }

    get size(): number {
        let size = 0;
        for (const entityIds of this.#keys.values()) {
            size += entityIds.size;
        }
        return size;
    }

    get isEmpty(): boolean {
        return this.size === 0;
    }

    snapshot(): readonly ReadModelRevisionKey[] {
        const keys: ReadModelRevisionKey[] = [];
        for (const [domain, entityIds] of this.#keys) {
            for (const entityId of entityIds) {
                keys.push({ domain, entityId });
            }
        }
        return normalizeReadModelRevisionKeys(keys);
    }

    clear(): void {
        this.#keys.clear();
    }
}
