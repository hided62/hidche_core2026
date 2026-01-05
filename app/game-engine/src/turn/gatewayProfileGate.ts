import { createGatewayPostgresConnector } from '@sammo-ts/infra';

export interface GatewayProfileGateOptions {
    databaseUrl: string;
    gatewayDatabaseUrl?: string;
    profileName: string;
    cacheMs?: number;
}

export interface GatewayProfileGate {
    shouldPause(): Promise<boolean>;
    markPaused(error?: unknown): Promise<void>;
    close(): Promise<void>;
}

const DEFAULT_CACHE_MS = 2000;

const isRunningStatus = (status: string | null | undefined): boolean => status === 'RUNNING';

export const createGatewayProfileGate = async (options: GatewayProfileGateOptions): Promise<GatewayProfileGate> => {
    const connector = createGatewayPostgresConnector({
        url: options.gatewayDatabaseUrl ?? options.databaseUrl,
    });
    await connector.connect();
    const prisma = connector.prisma;
    let lastCheckedAt = 0;
    let cachedPause = false;

    const loadStatus = async (): Promise<boolean> => {
        try {
            const profile = await prisma.gatewayProfile.findUnique({
                where: { profileName: options.profileName },
            });
            if (!profile) {
                return false;
            }
            return !isRunningStatus(profile.status);
        } catch {
            return false;
        }
    };

    return {
        // 게이트웨이 프로필 상태를 읽어 턴 실행을 멈춰야 하는지 판단한다.
        async shouldPause(): Promise<boolean> {
            const now = Date.now();
            if (now - lastCheckedAt < (options.cacheMs ?? DEFAULT_CACHE_MS)) {
                return cachedPause;
            }
            cachedPause = await loadStatus();
            lastCheckedAt = now;
            return cachedPause;
        },
        async markPaused(error?: unknown): Promise<void> {
            const message = error instanceof Error ? error.message : error ? String(error) : null;
            try {
                await prisma.gatewayProfile.update({
                    where: { profileName: options.profileName },
                    data: {
                        status: 'PAUSED',
                        lastError: message,
                    },
                });
            } catch {
                return;
            }
        },
        async close(): Promise<void> {
            await connector.disconnect();
        },
    };
};
