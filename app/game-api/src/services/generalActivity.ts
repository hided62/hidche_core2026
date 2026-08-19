import { GamePrisma } from '@sammo-ts/infra';

import type { GameApiContext } from '../context.js';

const adminRoles = new Set(['superuser', 'admin', 'admin.superuser']);

/**
 * Records a completed, authenticated user mutation without changing the Ref
 * refresh counters. Page loads and read-model refreshes never call this path.
 */
export const recordGeneralActivity = async (
    ctx: Pick<GameApiContext, 'auth' | 'db'>,
    now = new Date()
): Promise<boolean> => {
    const user = ctx.auth?.user;
    if (!user || user.roles.some((role) => adminRoles.has(role))) {
        return false;
    }

    const written = await ctx.db.$executeRaw(
        GamePrisma.sql`
            INSERT INTO general_access_log (
                general_id,
                user_id,
                last_action_at
            )
            SELECT
                id,
                ${user.id},
                ${now}
            FROM "general"
            WHERE user_id = ${user.id}
            ORDER BY id ASC
            LIMIT 1
            ON CONFLICT (general_id) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                last_action_at = GREATEST(
                    general_access_log.last_action_at,
                    EXCLUDED.last_action_at
                )
        `
    );
    return written > 0;
};
