import fs from 'node:fs/promises';
import path from 'node:path';

import { isRecord } from '@sammo-ts/common';

export const RELEASE_CONTROLLER_PROTOCOL = 1;

export interface ReleaseManifest {
    formatVersion: 1;
    controllerProtocol: number;
    gatewaySchemaHead: string;
    gameSchemaHead: string;
    components: string[];
}

const assertMigrationHead = async (workspaceRoot: string, directory: string, expected: string): Promise<void> => {
    const migrationRoot = path.join(workspaceRoot, 'packages', 'infra', 'prisma', directory);
    const entries = await fs.readdir(migrationRoot, { withFileTypes: true });
    const latest = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .at(-1);
    if (!latest || latest !== expected) {
        throw new Error(
            `Release manifest ${directory} head ${expected} does not match workspace head ${latest ?? 'none'}.`
        );
    }
};

export const readReleaseManifest = async (workspaceRoot: string): Promise<ReleaseManifest> => {
    const manifestPath = path.join(workspaceRoot, 'release-manifest.json');
    const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
    if (
        !isRecord(parsed) ||
        parsed.formatVersion !== 1 ||
        typeof parsed.controllerProtocol !== 'number' ||
        !Number.isInteger(parsed.controllerProtocol) ||
        typeof parsed.gatewaySchemaHead !== 'string' ||
        typeof parsed.gameSchemaHead !== 'string' ||
        !Array.isArray(parsed.components) ||
        !parsed.components.every((component) => typeof component === 'string')
    ) {
        throw new Error(`Invalid release manifest: ${manifestPath}`);
    }
    if (parsed.controllerProtocol > RELEASE_CONTROLLER_PROTOCOL) {
        throw new Error(
            `Release requires controller protocol ${parsed.controllerProtocol}; this controller supports ${RELEASE_CONTROLLER_PROTOCOL}.`
        );
    }
    const manifest = parsed as unknown as ReleaseManifest;
    await Promise.all([
        assertMigrationHead(workspaceRoot, 'gateway-migrations', manifest.gatewaySchemaHead),
        assertMigrationHead(workspaceRoot, 'migrations', manifest.gameSchemaHead),
    ]);
    return manifest;
};

export const assertReleaseComponents = (manifest: ReleaseManifest, required: string[]): void => {
    const available = new Set(manifest.components);
    const missing = required.filter((component) => !available.has(component));
    if (missing.length) {
        throw new Error(`Release manifest is missing components: ${missing.join(', ')}`);
    }
};
