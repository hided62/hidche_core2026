import { router } from './trpc.js';

import { battleRouter } from './router/battle/index.js';
import { authRouter } from './router/auth/index.js';
import { generalRouter } from './router/general/index.js';
import { healthRouter } from './router/health/index.js';
import { joinRouter } from './router/join/index.js';
import { inheritRouter } from './router/inherit/index.js';
import { lobbyRouter } from './router/lobby/index.js';
import { messagesRouter } from './router/messages/index.js';
import { nationRouter } from './router/nation/index.js';
import { npcRouter } from './router/npc/index.js';
import { publicRouter } from './router/public/index.js';
import { troopRouter } from './router/troop/index.js';
import { turnDaemonRouter } from './router/turnDaemon/index.js';
import { turnsRouter } from './router/turns/index.js';
import { worldRouter } from './router/world/index.js';
import { auctionRouter } from './router/auction/index.js';
import { tournamentRouter } from './router/tournament/index.js';
import { boardRouter } from './router/board/index.js';

export const appRouter = router({
    health: healthRouter,
    auth: authRouter,
    lobby: lobbyRouter,
    public: publicRouter,
    join: joinRouter,
    inherit: inheritRouter,
    battle: battleRouter,
    world: worldRouter,
    turns: turnsRouter,
    messages: messagesRouter,
    troop: troopRouter,
    general: generalRouter,
    nation: nationRouter,
    npc: npcRouter,
    turnDaemon: turnDaemonRouter,
    auction: auctionRouter,
    tournament: tournamentRouter,
    board: boardRouter,
});

export type AppRouter = typeof appRouter;
