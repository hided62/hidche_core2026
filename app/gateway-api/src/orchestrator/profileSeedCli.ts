import fs from 'node:fs/promises';
import path from 'node:path';

import type { ScenarioInstallOptions } from '@sammo-ts/game-engine';

import { seedProfileDatabase, type AdminSeedUser } from './seedProfileDatabase.js';

interface ProfileSeedRequest {
    scenarioId: number;
    tickSeconds?: number;
    now: string;
    installOptions?: Omit<ScenarioInstallOptions, 'preopenAt'> & { preopenAt?: string | null };
    adminUser?: AdminSeedUser | null;
}

export const parseProfileSeedRequest = (value: unknown): ProfileSeedRequest => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Profile seed request must be an object.');
    }
    const request = value as Record<string, unknown>;
    if (typeof request.scenarioId !== 'number' || !Number.isInteger(request.scenarioId)) {
        throw new Error('Profile seed scenarioId must be an integer.');
    }
    if (typeof request.now !== 'string' || Number.isNaN(new Date(request.now).getTime())) {
        throw new Error('Profile seed now must be an ISO date-time.');
    }
    if (
        request.tickSeconds !== undefined &&
        (typeof request.tickSeconds !== 'number' || !Number.isFinite(request.tickSeconds))
    ) {
        throw new Error('Profile seed tickSeconds must be finite.');
    }
    return request as unknown as ProfileSeedRequest;
};

export const runProfileSeedCli = async (env: NodeJS.ProcessEnv = process.env): Promise<void> => {
    const requestFile = env.PROFILE_SEED_REQUEST_FILE;
    const databaseUrl = env.DATABASE_URL;
    if (!requestFile) {
        throw new Error('PROFILE_SEED_REQUEST_FILE is required.');
    }
    if (!databaseUrl) {
        throw new Error('DATABASE_URL is required.');
    }

    const request = parseProfileSeedRequest(JSON.parse(await fs.readFile(requestFile, 'utf8')));
    const rawPreopenAt = request.installOptions?.preopenAt;
    const preopenAt = typeof rawPreopenAt === 'string' ? new Date(rawPreopenAt) : null;
    if (preopenAt && Number.isNaN(preopenAt.getTime())) {
        throw new Error('Profile seed preopenAt must be an ISO date-time.');
    }
    const resourceRoot = path.join(process.cwd(), 'resources');

    await seedProfileDatabase({
        databaseUrl,
        scenarioId: request.scenarioId,
        tickSeconds: request.tickSeconds,
        now: new Date(request.now),
        installOptions: request.installOptions
            ? {
                  ...request.installOptions,
                  preopenAt,
              }
            : undefined,
        scenarioOptions: { scenarioRoot: path.join(resourceRoot, 'scenario') },
        mapOptions: { mapRoot: path.join(resourceRoot, 'map') },
        unitSetOptions: { unitSetRoot: path.join(resourceRoot, 'unitset') },
        adminUser: request.adminUser,
    });
};
