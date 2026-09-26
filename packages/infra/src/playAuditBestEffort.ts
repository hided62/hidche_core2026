import type { GamePrisma } from './gamePrisma.js';

/** Only audit work belongs here. A broken outer transaction/connection still propagates. */
export const withPlayAuditSavepoint = async <
    T,
    Db extends Pick<GamePrisma.TransactionClient, '$executeRaw' | '$queryRaw'>,
>(
    db: Db,
    collect: (auditDb: Db) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false }> => {
    await db.$executeRaw`SAVEPOINT play_audit_optional`;
    try {
        const [settings] = await db.$queryRaw<Array<{ statement: string; lock: string }>>`
            SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock
        `;
        // Bound audit lock waits and individual statements, without relaxing tighter caller limits.
        await db.$queryRaw`
            SELECT set_config('statement_timeout',
                CASE WHEN current_setting('statement_timeout') = '0' THEN '1000ms'
                     ELSE LEAST(EXTRACT(EPOCH FROM current_setting('statement_timeout')::interval) * 1000, 1000)::text || 'ms' END, true),
                   set_config('lock_timeout', CASE WHEN current_setting('lock_timeout') = '0' THEN '250ms' ELSE LEAST(EXTRACT(EPOCH FROM current_setting('lock_timeout')::interval) * 1000, 250)::text || 'ms' END, true)
        `;
        const deadline = performance.now() + 1000;
        const checkBudget = () => {
            if (performance.now() >= deadline) throw new Error('Audit budget exhausted');
        };
        const bound = <ObjectType extends object>(target: ObjectType): ObjectType =>
            new Proxy(target, {
                get(object, property) {
                    const value: unknown = Reflect.get(object, property);
                    if (typeof value === 'function')
                        return async (...args: unknown[]) => {
                            checkBudget();
                            const result: unknown = await Reflect.apply(value, object, args);
                            checkBudget();
                            return result;
                        };
                    return value && typeof value === 'object' ? bound(value) : value;
                },
            });
        const value = await collect(bound(db));
        checkBudget();
        await db.$queryRaw`SELECT set_config('statement_timeout', ${settings!.statement}, true), set_config('lock_timeout', ${settings!.lock}, true)`;
        await db.$executeRaw`RELEASE SAVEPOINT play_audit_optional`;
        return { ok: true, value };
    } catch (error) {
        // SQL errors poison PostgreSQL transactions. Catch alone is not sufficient.
        await db.$executeRaw`ROLLBACK TO SAVEPOINT play_audit_optional`;
        await db.$executeRaw`RELEASE SAVEPOINT play_audit_optional`;
        // This notice uses the core row, not the possibly unavailable audit schema.
        await db.$executeRaw`UPDATE world_state SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{playAuditGap}',
            jsonb_build_object('serverId', meta->'serverId',
                'firstYear', CASE WHEN meta->'playAuditGap'->>'serverId' = meta->>'serverId' THEN COALESCE(meta->'playAuditGap'->'firstYear', to_jsonb(current_year)) ELSE to_jsonb(current_year) END,
                'firstMonth', CASE WHEN meta->'playAuditGap'->>'serverId' = meta->>'serverId' THEN COALESCE(meta->'playAuditGap'->'firstMonth', to_jsonb(current_month)) ELSE to_jsonb(current_month) END,
                'lastYear', current_year, 'lastMonth', current_month, 'stage', 'persistence'))
            WHERE id = (SELECT id FROM world_state ORDER BY id LIMIT 1)`;
        // Never log payloads, SQL or actor details here.
        const code =
            error && typeof error === 'object' && 'code' in error && /^[A-Z0-9_]{1,20}$/.test(String(error.code))
                ? String(error.code)
                : 'AUDIT_ERROR';
        console.warn(`[play-audit] ${code}: audit batch discarded; gameplay continues with a history gap.`);
        return { ok: false };
    }
};
