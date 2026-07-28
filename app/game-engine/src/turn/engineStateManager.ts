export interface EngineStateParticipant<T> {
    capture(): T;
    restore(snapshot: T): void;
    inspect?(): unknown;
}

type RegisteredParticipant = {
    capture(): unknown;
    restore(snapshot: unknown): void;
    inspect?(): unknown;
};

type CapturedParticipant = {
    name: string;
    snapshot: unknown;
};

type EngineStateSavepointData = {
    owner: symbol;
    participants: readonly CapturedParticipant[];
};

const savepointData = new WeakMap<EngineStateSavepoint, EngineStateSavepointData>();

export interface EngineStateInspection {
    revision: number;
    transactionActive: boolean;
    participants: Readonly<Record<string, unknown>>;
}

export class EngineStateSavepoint {
    readonly revision: number;

    constructor(owner: symbol, revision: number, participants: CapturedParticipant[]) {
        this.revision = revision;
        savepointData.set(this, { owner, participants });
    }
}

/**
 * Coordinates the mutable state owned by the game-engine worker.
 *
 * The manager deliberately knows nothing about PostgreSQL or Redis. Database
 * transactions remain in databaseHooks; this boundary only prevents a failed
 * calculation from leaving a partially-mutated in-memory world behind.
 */
export class EngineStateManager {
    private readonly owner = Symbol('EngineStateManager');
    private readonly participants = new Map<string, RegisteredParticipant>();
    private revision = 0;
    private transactionActive = false;

    register<T>(name: string, participant: EngineStateParticipant<T>): void {
        if (this.transactionActive) {
            throw new Error('Cannot register engine state while a transaction is active.');
        }
        if (!name) {
            throw new Error('Engine state participant name is required.');
        }
        if (this.participants.has(name)) {
            throw new Error(`Engine state participant is already registered: ${name}`);
        }
        this.participants.set(name, {
            capture: () => participant.capture(),
            restore: (snapshot) => participant.restore(snapshot as T),
            inspect: participant.inspect ? () => participant.inspect?.() : undefined,
        });
    }

    getRevision(): number {
        return this.revision;
    }

    isTransactionActive(): boolean {
        return this.transactionActive;
    }

    capture(): EngineStateSavepoint {
        const captured: CapturedParticipant[] = [];
        for (const [name, participant] of this.participants) {
            captured.push({ name, snapshot: participant.capture() });
        }
        return new EngineStateSavepoint(this.owner, this.revision, captured);
    }

    restore(savepoint: EngineStateSavepoint): void {
        if (this.transactionActive) {
            throw new Error('Cannot restore engine state while a transaction is active.');
        }
        this.assertOwnedSavepoint(savepoint);
        this.restoreParticipants(savepoint);
        this.revision += 1;
    }

    inspect(): EngineStateInspection {
        const participants: Record<string, unknown> = {};
        for (const [name, participant] of this.participants) {
            participants[name] = structuredClone(participant.inspect ? participant.inspect() : participant.capture());
        }
        return {
            revision: this.revision,
            transactionActive: this.transactionActive,
            participants,
        };
    }

    async transaction<T>(operation: () => Promise<T> | T): Promise<T> {
        if (this.transactionActive) {
            throw new Error('Nested engine state transactions are not supported.');
        }
        const savepoint = this.capture();
        this.transactionActive = true;
        try {
            const result = await operation();
            this.revision += 1;
            return result;
        } catch (error) {
            try {
                this.restoreParticipants(savepoint);
            } catch (restoreError) {
                throw new AggregateError(
                    [error, restoreError],
                    'Engine state operation failed and its in-memory state could not be restored.',
                    { cause: restoreError }
                );
            }
            throw error;
        } finally {
            this.transactionActive = false;
        }
    }

    private assertOwnedSavepoint(savepoint: EngineStateSavepoint): void {
        if (savepointData.get(savepoint)?.owner !== this.owner) {
            throw new Error('Engine state savepoint belongs to a different manager.');
        }
    }

    private restoreParticipants(savepoint: EngineStateSavepoint): void {
        this.assertOwnedSavepoint(savepoint);
        const capturedParticipants = savepointData.get(savepoint)?.participants;
        if (!capturedParticipants) {
            throw new Error('Engine state savepoint data is unavailable.');
        }
        const currentNames = Array.from(this.participants.keys());
        const capturedNames = capturedParticipants.map(({ name }) => name);
        if (
            currentNames.length !== capturedNames.length ||
            currentNames.some((name, index) => name !== capturedNames[index])
        ) {
            throw new Error('Engine state participant set changed after the savepoint was captured.');
        }
        for (let index = capturedParticipants.length - 1; index >= 0; index -= 1) {
            const captured = capturedParticipants[index];
            if (!captured) {
                continue;
            }
            this.participants.get(captured.name)?.restore(captured.snapshot);
        }
    }
}
