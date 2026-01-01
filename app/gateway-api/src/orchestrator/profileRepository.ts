import { Prisma, type PrismaClient } from '@prisma/client';

export const GATEWAY_PROFILE_STATUSES = [
    'COMPLETED',
    'RESERVED',
    'RUNNING',
    'STOPPED',
    'DISABLED',
] as const;
export type GatewayProfileStatus = (typeof GATEWAY_PROFILE_STATUSES)[number];

export const GATEWAY_BUILD_STATUSES = [
    'IDLE',
    'QUEUED',
    'RUNNING',
    'FAILED',
    'SUCCEEDED',
] as const;
export type GatewayBuildStatus = (typeof GATEWAY_BUILD_STATUSES)[number];

export interface GatewayProfileRecord {
    profileName: string;
    profile: string;
    scenario: string;
    apiPort: number;
    status: GatewayProfileStatus;
    buildStatus: GatewayBuildStatus;
    scheduledStartAt?: string;
    buildRequestedAt?: string;
    buildStartedAt?: string;
    buildCompletedAt?: string;
    buildError?: string;
    lastError?: string;
    meta: Prisma.JsonObject;
    createdAt: string;
    updatedAt: string;
}

export interface GatewayProfileUpsertInput {
    profile: string;
    scenario: string;
    apiPort: number;
    status?: GatewayProfileStatus;
    scheduledStartAt?: string;
    meta?: Prisma.JsonObject;
}

export interface GatewayProfileRepository {
    listProfiles(): Promise<GatewayProfileRecord[]>;
    getProfile(profileName: string): Promise<GatewayProfileRecord | null>;
    upsertProfile(input: GatewayProfileUpsertInput): Promise<GatewayProfileRecord>;
    updateStatus(
        profileName: string,
        status: GatewayProfileStatus,
        scheduledStartAt?: string | null
    ): Promise<GatewayProfileRecord | null>;
    updateBuildStatus(
        profileName: string,
        status: GatewayBuildStatus,
        fields?: {
            requestedAt?: string | null;
            startedAt?: string | null;
            completedAt?: string | null;
            error?: string | null;
        }
    ): Promise<GatewayProfileRecord | null>;
    listReservedToStart(now: Date): Promise<GatewayProfileRecord[]>;
    findQueuedBuild(): Promise<GatewayProfileRecord | null>;
    updateLastError(profileName: string, lastError: string | null): Promise<void>;
}

const toIso = (value: Date | null): string | undefined =>
    value ? value.toISOString() : undefined;

const mapProfile = (row: {
    profileName: string;
    profile: string;
    scenario: string;
    apiPort: number;
    status: GatewayProfileStatus;
    buildStatus: GatewayBuildStatus;
    scheduledStartAt: Date | null;
    buildRequestedAt: Date | null;
    buildStartedAt: Date | null;
    buildCompletedAt: Date | null;
    buildError: string | null;
    lastError: string | null;
    meta: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
}): GatewayProfileRecord => ({
    profileName: row.profileName,
    profile: row.profile,
    scenario: row.scenario,
    apiPort: row.apiPort,
    status: row.status,
    buildStatus: row.buildStatus,
    scheduledStartAt: toIso(row.scheduledStartAt),
    buildRequestedAt: toIso(row.buildRequestedAt),
    buildStartedAt: toIso(row.buildStartedAt),
    buildCompletedAt: toIso(row.buildCompletedAt),
    buildError: row.buildError ?? undefined,
    lastError: row.lastError ?? undefined,
    meta: (row.meta ?? {}) as Prisma.JsonObject,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
});

const buildProfileName = (profile: string, scenario: string): string =>
    `${profile}:${scenario}`;

export const createGatewayProfileRepository = (
    prisma: PrismaClient
): GatewayProfileRepository => ({
    async listProfiles(): Promise<GatewayProfileRecord[]> {
        const rows = await prisma.gatewayProfile.findMany({
            orderBy: [{ profile: 'asc' }, { scenario: 'asc' }],
        });
        return rows.map(mapProfile);
    },
    async getProfile(profileName: string): Promise<GatewayProfileRecord | null> {
        const row = await prisma.gatewayProfile.findUnique({
            where: { profileName },
        });
        return row ? mapProfile(row) : null;
    },
    async upsertProfile(input: GatewayProfileUpsertInput): Promise<GatewayProfileRecord> {
        const profileName = buildProfileName(input.profile, input.scenario);
        const row = await prisma.gatewayProfile.upsert({
            where: { profileName },
            create: {
                profileName,
                profile: input.profile,
                scenario: input.scenario,
                apiPort: input.apiPort,
                status: input.status ?? 'STOPPED',
                scheduledStartAt: input.scheduledStartAt
                    ? new Date(input.scheduledStartAt)
                    : null,
                meta: (input.meta ?? {}) as Prisma.JsonObject,
            },
            update: {
                apiPort: input.apiPort,
                status: input.status,
                scheduledStartAt: input.scheduledStartAt
                    ? new Date(input.scheduledStartAt)
                    : input.scheduledStartAt === null
                      ? null
                      : undefined,
                meta: input.meta ? (input.meta as Prisma.JsonObject) : undefined,
            },
        });
        return mapProfile(row);
    },
    async updateStatus(
        profileName: string,
        status: GatewayProfileStatus,
        scheduledStartAt?: string | null
    ): Promise<GatewayProfileRecord | null> {
        const row = await prisma.gatewayProfile.update({
            where: { profileName },
            data: {
                status,
                scheduledStartAt:
                    scheduledStartAt === undefined
                        ? undefined
                        : scheduledStartAt
                          ? new Date(scheduledStartAt)
                          : null,
            },
        });
        return row ? mapProfile(row) : null;
    },
    async updateBuildStatus(
        profileName: string,
        status: GatewayBuildStatus,
        fields?: {
            requestedAt?: string | null;
            startedAt?: string | null;
            completedAt?: string | null;
            error?: string | null;
        }
    ): Promise<GatewayProfileRecord | null> {
        const row = await prisma.gatewayProfile.update({
            where: { profileName },
            data: {
                buildStatus: status,
                buildRequestedAt:
                    fields?.requestedAt === undefined
                        ? undefined
                        : fields?.requestedAt
                          ? new Date(fields.requestedAt)
                          : null,
                buildStartedAt:
                    fields?.startedAt === undefined
                        ? undefined
                        : fields?.startedAt
                          ? new Date(fields.startedAt)
                          : null,
                buildCompletedAt:
                    fields?.completedAt === undefined
                        ? undefined
                        : fields?.completedAt
                          ? new Date(fields.completedAt)
                          : null,
                buildError: fields?.error === undefined ? undefined : fields.error,
            },
        });
        return row ? mapProfile(row) : null;
    },
    async listReservedToStart(now: Date): Promise<GatewayProfileRecord[]> {
        const rows = await prisma.gatewayProfile.findMany({
            where: {
                status: 'RESERVED',
                scheduledStartAt: {
                    lte: now,
                },
            },
        });
        return rows.map(mapProfile);
    },
    async findQueuedBuild(): Promise<GatewayProfileRecord | null> {
        const row = await prisma.gatewayProfile.findFirst({
            where: { buildStatus: 'QUEUED' },
            orderBy: { buildRequestedAt: 'asc' },
        });
        return row ? mapProfile(row) : null;
    },
    async updateLastError(profileName: string, lastError: string | null): Promise<void> {
        await prisma.gatewayProfile.update({
            where: { profileName },
            data: { lastError },
        });
    },
});
