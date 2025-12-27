export const TriggerPriority = {
    Min: 0,
    Begin: 10000,
    Pre: 20000,
    Body: 30000,
    Post: 40000,
    Final: 50000,
} as const;

export type TriggerPriority = (typeof TriggerPriority)[keyof typeof TriggerPriority];

export interface Trigger<TContext, TEnv = Record<string, unknown>, TArg = unknown> {
    readonly priority: number;
    readonly uniqueId: string;
    action(context: TContext, env: TEnv, arg?: TArg): TEnv;
}

export class TriggerCaller<TContext, TEnv = Record<string, unknown>, TArg = unknown> {
    private readonly triggersByPriority = new Map<number, Map<string, Trigger<TContext, TEnv, TArg>>>();

    constructor(...triggers: Array<Trigger<TContext, TEnv, TArg>>) {
        if (triggers.length === 0) {
            return;
        }

        for (const trigger of triggers) {
            this.append(trigger);
        }
    }

    isEmpty(): boolean {
        return this.triggersByPriority.size === 0;
    }

    append(trigger: Trigger<TContext, TEnv, TArg>): this {
        const priority = trigger.priority;
        const uniqueId = trigger.uniqueId;
        const bucket = this.triggersByPriority.get(priority) ?? new Map();

        bucket.set(uniqueId, trigger);
        this.triggersByPriority.set(priority, bucket);

        return this;
    }

    merge(other: TriggerCaller<TContext, TEnv, TArg> | null | undefined): this {
        if (!other) {
            return this;
        }

        for (const [priority, otherBucket] of other.triggersByPriority.entries()) {
            const bucket = this.triggersByPriority.get(priority) ?? new Map();
            for (const [uniqueId, trigger] of otherBucket.entries()) {
                bucket.set(uniqueId, trigger);
            }
            this.triggersByPriority.set(priority, bucket);
        }

        return this;
    }

    fire(context: TContext, env: TEnv, arg?: TArg): TEnv {
        let currentEnv = env;
        const priorities = Array.from(this.triggersByPriority.keys()).sort((a, b) => a - b);

        for (const priority of priorities) {
            const bucket = this.triggersByPriority.get(priority);
            if (!bucket) {
                continue;
            }
            for (const trigger of bucket.values()) {
                currentEnv = trigger.action(context, currentEnv, arg);
            }
        }

        return currentEnv;
    }
}
