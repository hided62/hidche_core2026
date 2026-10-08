import { safeTrpcErrorFormatter } from '@sammo-ts/common';
import { initTRPC } from '@trpc/server';

import type { GatewayApiContext } from './context.js';

const t = initTRPC.context<GatewayApiContext>().create({ errorFormatter: safeTrpcErrorFormatter });

export const router = t.router;
export const procedure = t.procedure;
