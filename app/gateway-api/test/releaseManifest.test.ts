import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readReleaseManifest, RELEASE_CONTROLLER_PROTOCOL } from '../src/orchestrator/releaseManifest.js';

const temporaryDirectories: string[] = [];

const createWorkspace = async (gatewayHead: string, gameHead: string, controllerProtocol = 1): Promise<string> => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-release-manifest-'));
    temporaryDirectories.push(workspace);
    await fs.mkdir(path.join(workspace, 'packages/infra/prisma/gateway-migrations', gatewayHead), {
        recursive: true,
    });
    await fs.mkdir(path.join(workspace, 'packages/infra/prisma/migrations', gameHead), { recursive: true });
    await fs.writeFile(
        path.join(workspace, 'release-manifest.json'),
        JSON.stringify({
            formatVersion: 1,
            controllerProtocol,
            gatewaySchemaHead: gatewayHead,
            gameSchemaHead: gameHead,
            components: ['gateway-api', 'gateway-frontend', 'game-api', 'game-engine', 'game-frontend'],
        })
    );
    return workspace;
};

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

describe('readReleaseManifest', () => {
    it('keeps the checked-in manifest aligned with the checked-in migration heads', async () => {
        const workspaceRoot = path.resolve(import.meta.dirname, '../../..');

        await expect(readReleaseManifest(workspaceRoot)).resolves.toMatchObject({
            controllerProtocol: RELEASE_CONTROLLER_PROTOCOL,
            gatewaySchemaHead: '20260823010000_add_web_push_notifications',
            gameSchemaHead: '20260823010000_add_web_push_outbox',
        });
    });

    it('accepts a manifest whose schema heads match the selected workspace', async () => {
        const workspace = await createWorkspace('20260801000000_gateway', '20260801000000_game');

        await expect(readReleaseManifest(workspace)).resolves.toMatchObject({
            gatewaySchemaHead: '20260801000000_gateway',
            gameSchemaHead: '20260801000000_game',
        });
    });

    it('rejects a stale schema head before any deployment command runs', async () => {
        const workspace = await createWorkspace('20260801000000_gateway', '20260801000000_game');
        await fs.mkdir(path.join(workspace, 'packages/infra/prisma/migrations/20260802000000_newer'));

        await expect(readReleaseManifest(workspace)).rejects.toThrow('does not match workspace head');
    });

    it('allows only the explicit controller self-upgrade boundary to cross protocol versions', async () => {
        const futureProtocol = RELEASE_CONTROLLER_PROTOCOL + 1;
        const workspace = await createWorkspace('20260801000000_gateway', '20260801000000_game', futureProtocol);

        await expect(readReleaseManifest(workspace)).rejects.toThrow(
            `Release requires controller protocol ${futureProtocol}`
        );
        await expect(readReleaseManifest(workspace, { allowControllerUpgrade: true })).resolves.toMatchObject({
            controllerProtocol: futureProtocol,
        });
    });
});
