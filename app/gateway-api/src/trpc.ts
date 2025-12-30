import { initTRPC } from '@trpc/server';

import type { GatewayApiContext } from './context.js';

const t = initTRPC.context<GatewayApiContext>().create();

export const router = t.router;
export const procedure = t.procedure;
