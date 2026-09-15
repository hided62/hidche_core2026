import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

import { describeRuntimeError, gatewayProfileCapabilities, type GatewayProfileStatus } from '@sammo-ts/common';
import { createGatewayPostgresConnector } from '@sammo-ts/infra';

import { TurnDaemonLeaseLostError } from '../lifecycle/databaseTurnDaemonLease.js';

export interface GatewayProfileGateOptions {
    databaseUrl: string;
    gatewayDatabaseUrl?: string;
    profileName: string;
    cacheMs?: number;
    incidentContext?: () => Record<string, string | number | boolean | null>;
}

export interface GatewayProfileGate {
    shouldPause(): Promise<boolean>;
    isExplicitlyPaused(): boolean;
    reportFailure(error?: unknown): Promise<void>;
    close(): Promise<void>;
}

const DEFAULT_CACHE_MS = 2000;
const PROFILE_STATUSES_MARKABLE_AS_PAUSED = ['PREOPEN', 'RUNNING', 'PAUSED'] as const;

export const createGatewayProfileGate = async (options: GatewayProfileGateOptions): Promise<GatewayProfileGate> => {
    const connector = createGatewayPostgresConnector({
        url: options.gatewayDatabaseUrl ?? options.databaseUrl,
        connectionTimeoutMillis: 3000,
    });
    await connector.connect();
    const prisma = connector.prisma;
    const reportedLeaseErrors = new WeakSet<TurnDaemonLeaseLostError>();
    let lastCheckedAt = 0;
    let cachedPause = false;
    let cachedStatus: GatewayProfileStatus | null = null;

    const loadStatus = async (): Promise<boolean> => {
        try {
            const profile = await prisma.gatewayProfile.findUnique({
                where: { profileName: options.profileName },
            });
            cachedStatus = (profile?.status as GatewayProfileStatus | undefined) ?? null;
            if (!profile) {
                return false;
            }
            return !gatewayProfileCapabilities(profile.status as GatewayProfileStatus).turnsRunning;
        } catch {
            return false;
        }
    };

    return {
        isExplicitlyPaused: () => cachedStatus === 'PAUSED',
        // 게이트웨이 프로필 상태를 읽어 턴 실행을 멈춰야 하는지 판단한다.
        async shouldPause(): Promise<boolean> {
            const now = performance.now();
            if (now - lastCheckedAt < (options.cacheMs ?? DEFAULT_CACHE_MS)) {
                return cachedPause;
            }
            cachedPause = await loadStatus();
            lastCheckedAt = now;
            return cachedPause;
        },
        async reportFailure(error?: unknown): Promise<void> {
            // VM 정지/시계 보정으로 lease를 잃은 실행자는 종료하고 새 owner가
            // DB를 다시 읽는다. 운영자의 RUNNING/PAUSED/STOPPED 의도는 덮어쓰지 않는다.
            const recoverable = error instanceof TurnDaemonLeaseLostError;
            if (recoverable && reportedLeaseErrors.has(error)) return;
            if (!recoverable) {
                cachedPause = true;
                cachedStatus = 'PAUSED';
                lastCheckedAt = performance.now();
            }
            const failure = error ? describeRuntimeError(error) : null;
            const message = failure?.message ?? null;
            try {
                await prisma.$transaction(async (tx) => {
                    const updated = recoverable
                        ? null
                        : await tx.gatewayProfile.updateMany({
                              where: {
                                  profileName: options.profileName,
                                  status: { in: [...PROFILE_STATUSES_MARKABLE_AS_PAUSED] },
                                  OR: [
                                      { status: { not: 'PAUSED' } },
                                      { lastError: { not: message } },
                                      { lastError: null },
                                  ],
                              },
                              data: {
                                  status: 'PAUSED',
                                  lastError: message,
                              },
                          });
                    if ((recoverable || updated?.count) && failure) {
                        // 상태와 이력을 함께 commit한다. 재개가 lastError를 지워도
                        // 당시 원인과 실행 좌표는 관리자 감사 저장소에 남는다.
                        await tx.adminAuditEvent.create({
                            data: {
                                correlationId: randomUUID(),
                                actorUserId: 'system:turn-daemon',
                                actorUsername: 'turn-daemon',
                                credentialKind: 'DAEMON',
                                action: 'runtime.failure',
                                targetType: 'profile-runtime',
                                targetId: options.profileName,
                                profileName: options.profileName,
                                outcome: 'FAILED',
                                errorCode: failure.code,
                                errorMessage: failure.message,
                                summary: {
                                    frames: failure.frames,
                                    ...options.incidentContext?.(),
                                    recovery: recoverable ? 'RESTART' : 'OPERATOR',
                                },
                            },
                        });
                    }
                });
                if (recoverable) reportedLeaseErrors.add(error);
            } catch {
                if (failure) console.error('[turn-daemon] failed to persist runtime incident', failure);
                return;
            }
        },
        async close(): Promise<void> {
            await connector.disconnect();
        },
    };
};
