import { TRPCError } from '@trpc/server';

import type { TurnDaemonCommandResult } from '@sammo-ts/common';

export const throwIfCommandRejected = (result: TurnDaemonCommandResult | null): void => {
    if (result?.type !== 'commandRejected') {
        return;
    }
    throw new TRPCError({ code: 'FORBIDDEN', message: result.reason });
};
