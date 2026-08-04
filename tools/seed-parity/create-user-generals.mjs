#!/usr/bin/env node

import { DatabaseTurnDaemonTransport } from '../../app/game-api/dist/index.js';
import {
    createTurnDaemonRuntime,
    resolveDatabaseUrl,
} from '../../app/game-engine/dist/index.js';
import { createGamePostgresConnector } from '../../packages/infra/dist/index.js';

const userCount = Number.parseInt(process.env.SEED_PARITY_USER_COUNT ?? '2', 10);
if (!Number.isInteger(userCount) || userCount < 1 || userCount > 10) {
    throw new Error('SEED_PARITY_USER_COUNT must be an integer between 1 and 10');
}

const databaseUrl = await resolveDatabaseUrl();
const profile = process.env.PROFILE ?? 'hwe';
const connector = createGamePostgresConnector({ url: databaseUrl });
await connector.connect();

const runtime = await createTurnDaemonRuntime({
    profile,
    databaseUrl,
    enableDatabaseFlush: true,
    enableLeaseHeartbeat: false,
    leaseOwnerId: `${profile}-seed-parity-user-setup`,
    gameClockMode: 'manual',
});
const daemon = new DatabaseTurnDaemonTransport(connector.prisma, 30_000);
// Manual mode intentionally advances scheduled turns without wall-clock waits.
// Pause before the loop starts so this setup command cannot consume month 1.
runtime.lifecycle.pause('seed parity user setup');
const daemonLoop = runtime.lifecycle.start();

try {
    await daemon.requestStatus(30_000);
    for (let number = 1; number <= userCount; number += 1) {
        const userId = `gc2400-user-${String(number).padStart(2, '0')}`;
        const ownerDisplayName = `올스타${String(number).padStart(2, '0')}`;
        const generalName = `비교유저${String(number).padStart(2, '0')}`;
        const result = await daemon.requestCommand(
            {
                type: 'joinCreateGeneral',
                userId,
                ownerDisplayName,
                seedOwnerIdentity: number + 1,
                name: generalName,
                leadership: 100,
                strength: 105,
                intel: 105,
                pic: false,
                character: 'che_안전',
                profileId: profile,
            },
            30_000
        );
        if (result?.type !== 'joinCreateGeneral' || !result.ok) {
            throw new Error(`Failed to create ${userId}: ${JSON.stringify(result)}`);
        }

        // Match the one explicit legacy appointment reservation. The remaining
        // slots stay as Rest so the scenario's autorun-user policy owns them.
        await connector.prisma.$transaction([
            connector.prisma.generalTurn.update({
                where: { generalId_turnIdx: { generalId: result.generalId, turnIdx: 0 } },
                data: { actionCode: 'che_랜덤임관', arg: {} },
            }),
            connector.prisma.generalTurnRevision.update({
                where: { generalId: result.generalId },
                data: { revision: { increment: 1 } },
            }),
        ]);
        console.log(`${userId} created ${generalName} as general ${result.generalId}`);
    }
} finally {
    await runtime.lifecycle.stop('seed parity user setup complete');
    await daemonLoop;
    await runtime.close();
    await connector.disconnect();
}
