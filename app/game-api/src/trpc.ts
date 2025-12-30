import { initTRPC } from '@trpc/server';

import type { GameApiContext } from './context.js';

const t = initTRPC.context<GameApiContext>().create();

export const router = t.router;
export const procedure = t.procedure;
