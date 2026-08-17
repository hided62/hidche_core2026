import type { GamePrisma, GamePrismaClient } from '@sammo-ts/infra';
import { randomUUID } from 'node:crypto';

import {
    buildGameEventChannel,
    writeTournamentProjection,
    type TurnDaemonCommand,
    type TurnDaemonCommandResult,
} from '@sammo-ts/common';

import type { GatewayAdminActionRecord, GatewayAdminActionResult } from './gatewayAdminActions.js';

interface RuntimeRedisClient {
    get(key: string): Promise<string | null>;
    set(
        key: string,
        value: string,
        options?: {
            NX?: boolean;
            PX?: number;
        }
    ): Promise<unknown>;
    del(key: string): Promise<unknown>;
    zAdd(key: string, values: Array<{ score: number; value: string }>): Promise<number>;
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
    publish?(channel: string, message: string): Promise<unknown>;
}

type TournamentClockState = {
    nextAt?: string;
    bettingCloseAt?: string;
    runtimeClockShiftActionIds?: string[];
    [key: string]: unknown;
};

const asJson = (value: unknown): GamePrisma.InputJsonValue => value as GamePrisma.InputJsonValue;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isUniqueConflict = (error: unknown): boolean =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

const shiftDateText = (value: unknown, deltaMinutes: number): unknown => {
    if (typeof value !== 'string' || !value.trim()) {
        return value;
    }
    const shifted = new Date(new Date(value).getTime() + deltaMinutes * 60_000);
    return Number.isNaN(shifted.getTime()) ? value : shifted.toISOString();
};

const syncAuctionTimers = async (
    db: GamePrismaClient,
    redis: RuntimeRedisClient,
    profileName: string
): Promise<number> => {
    const auctions = await db.auction.findMany({
        where: { status: 'OPEN' },
        select: { id: true, closeAt: true, closeTick: true },
    });
    if (auctions.length > 0) {
        await redis.zAdd(
            `sammo:${profileName}:auction:timer`,
            auctions.map((auction) => {
                const score = auction.closeTick == null ? auction.closeAt.getTime() : Number(auction.closeTick);
                if (!Number.isSafeInteger(score)) {
                    throw new Error(`Auction ${auction.id} has an unsafe logical deadline: ${auction.closeTick}`);
                }
                return { score, value: String(auction.id) };
            })
        );
    }
    return auctions.length;
};

const shiftTournamentClock = async (
    redis: RuntimeRedisClient,
    profileName: string,
    actionId: string,
    deltaMinutes: number
): Promise<boolean> => {
    const stateKey = `sammo:${profileName}:tournament:state`;
    const sourceKeys = {
        stateKey,
        sourceRevisionKey: `sammo:${profileName}:tournament:source-revision`,
        sourceRevisionChannel: `sammo:${profileName}:tournament:source-changed`,
        realtimeEventChannel: buildGameEventChannel(profileName),
    };
    const lockKey = `${stateKey}:mutation-lock`;
    const token = randomUUID();
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
        const acquired = await redis.set(lockKey, token, { NX: true, PX: 30_000 });
        if (acquired) {
            try {
                const rawState = await redis.get(stateKey);
                if (!rawState) {
                    return false;
                }
                const state = JSON.parse(rawState) as TournamentClockState;
                const applied = Array.isArray(state.runtimeClockShiftActionIds)
                    ? state.runtimeClockShiftActionIds.filter((entry): entry is string => typeof entry === 'string')
                    : [];
                if (applied.includes(actionId)) {
                    return true;
                }
                const nextState: TournamentClockState = {
                    ...state,
                    nextAt: shiftDateText(state.nextAt, deltaMinutes) as string | undefined,
                    bettingCloseAt: shiftDateText(state.bettingCloseAt, deltaMinutes) as string | undefined,
                    runtimeClockShiftActionIds: [...applied, actionId],
                };
                await writeTournamentProjection(redis, sourceKeys, [{ key: stateKey, value: nextState }]);
                return true;
            } finally {
                if ((await redis.get(lockKey)) === token) {
                    await redis.del(lockKey);
                }
            }
        }
        await sleep(10);
    }
    throw new Error('토너먼트 시간 조정 lock을 획득하지 못했습니다.');
};

const ensureEngineCommand = async (
    db: GamePrismaClient,
    actionId: string,
    deltaMinutes: number
): Promise<{ requestId: string; result?: TurnDaemonCommandResult; failed?: string }> => {
    const requestId = `gateway-runtime:${actionId}`;
    const command: TurnDaemonCommand = {
        type: 'shiftSchedule',
        requestId,
        actionId,
        deltaMinutes,
    };
    try {
        await db.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: command.type,
                payload: asJson(command),
            },
        });
    } catch (error) {
        if (!isUniqueConflict(error)) {
            throw error;
        }
        const existing = await db.inputEvent.findUniqueOrThrow({
            where: { requestId },
            select: { eventType: true, payload: true },
        });
        const payload = existing.payload as Partial<TurnDaemonCommand>;
        if (
            existing.eventType !== command.type ||
            payload.type !== command.type ||
            payload.actionId !== actionId ||
            payload.deltaMinutes !== deltaMinutes
        ) {
            return { requestId, failed: '같은 action ID에 다른 시간 조정 payload가 이미 존재합니다.' };
        }
    }

    const event = await db.inputEvent.findUniqueOrThrow({
        where: { requestId },
        select: { status: true, result: true, error: true },
    });
    if (event.status === 'FAILED') {
        return { requestId, failed: event.error ?? '게임 엔진 시간 조정이 실패했습니다.' };
    }
    if (event.status !== 'SUCCEEDED') {
        return { requestId };
    }
    return { requestId, result: event.result as TurnDaemonCommandResult };
};

export const applyRuntimeClockShift = async (options: {
    action: GatewayAdminActionRecord;
    profileName: string;
    db: GamePrismaClient;
    redis?: RuntimeRedisClient;
}): Promise<GatewayAdminActionResult> => {
    const { action, profileName, db, redis } = options;
    if (!action.id) {
        return { status: 'FAILED', detail: '시간 조정 action ID가 없습니다.' };
    }
    if (!Number.isInteger(action.durationMinutes) || (action.durationMinutes ?? 0) < 1) {
        return { status: 'FAILED', detail: '시간 조정 분은 1 이상의 정수여야 합니다.' };
    }
    const direction = action.action === 'ACCELERATE' ? -1 : action.action === 'DELAY' ? 1 : 0;
    if (direction === 0) {
        return { status: 'IGNORED', detail: `지원하지 않는 시간 조정 action입니다: ${action.action ?? ''}` };
    }
    const deltaMinutes = direction * action.durationMinutes!;
    const engine = await ensureEngineCommand(db, action.id, deltaMinutes);
    if (engine.failed) {
        return { status: 'FAILED', detail: engine.failed };
    }
    if (!engine.result) {
        return { status: 'REQUESTED', detail: `게임 엔진 처리 대기 중: ${engine.requestId}` };
    }
    if (engine.result.type !== 'shiftSchedule' || !engine.result.ok) {
        return {
            status: 'FAILED',
            detail:
                engine.result.type === 'shiftSchedule' ? engine.result.reason : '게임 엔진이 다른 결과를 반환했습니다.',
        };
    }
    if (!redis) {
        return {
            status: 'PARTIAL',
            detail: `DB 시간 조정은 적용됐지만 Redis timer 동기화를 기다리는 중입니다: ${engine.requestId}`,
        };
    }

    const syncedAuctions = await syncAuctionTimers(db, redis, profileName);
    const shiftedTournament = await shiftTournamentClock(redis, profileName, action.id, deltaMinutes);
    return {
        status: 'APPLIED',
        detail: [
            `${Math.abs(deltaMinutes)}분 ${deltaMinutes < 0 ? '가속' : '연기'}`,
            `장수 ${engine.result.shiftedGenerals}명`,
            `경매 ${engine.result.shiftedAuctions}건(DB)/${syncedAuctions}건(timer)`,
            shiftedTournament ? '토너먼트 적용' : '활성 토너먼트 없음',
        ].join(' · '),
    };
};
