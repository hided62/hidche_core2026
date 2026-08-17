import { randomUUID } from 'node:crypto';

import {
    buildGameEventChannel,
    GameClock,
    isRecord,
    writeTournamentProjection,
    type RuntimeAutorunUserOption,
    type RuntimeGameSettingsPatch,
    type TurnDaemonCommand,
    type TurnDaemonCommandResult,
} from '@sammo-ts/common';
import type { GamePrisma, GamePrismaClient } from '@sammo-ts/infra';

import type { GatewayAdminActionRecord, GatewayAdminActionResult } from './gatewayAdminActions.js';

interface RuntimeSettingsRedisClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { NX?: boolean; PX?: number }): Promise<unknown>;
    del(key: string): Promise<unknown>;
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
    publish?(channel: string, message: string): Promise<unknown>;
}

type TournamentClockState = {
    nextAt?: string;
    bettingCloseAt?: string;
    runtimeSettingsActionIds?: string[];
    [key: string]: unknown;
};

const TURN_TERMS = new Set([1, 2, 5, 10, 20, 30, 60, 120]);
const AUTORUN_OPTIONS = new Set<RuntimeAutorunUserOption>([
    'develop',
    'warp',
    'recruit',
    'recruit_high',
    'train',
    'battle',
    'chief',
]);
const asJson = (value: unknown): GamePrisma.InputJsonValue => value as GamePrisma.InputJsonValue;
const isUniqueConflict = (error: unknown): boolean =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeSettings = (value: unknown): RuntimeGameSettingsPatch | null => {
    if (!isRecord(value)) return null;
    const settings: RuntimeGameSettingsPatch = {};
    if (value.turnTermMinutes !== undefined) {
        if (!Number.isInteger(value.turnTermMinutes) || !TURN_TERMS.has(value.turnTermMinutes as number)) return null;
        settings.turnTermMinutes = value.turnTermMinutes as number;
    }
    if (value.blockGeneralCreate !== undefined) {
        if (![0, 1, 2].includes(value.blockGeneralCreate as number)) return null;
        settings.blockGeneralCreate = value.blockGeneralCreate as 0 | 1 | 2;
    }
    if (value.autorunUser !== undefined) {
        if (value.autorunUser === null) {
            settings.autorunUser = null;
        } else {
            if (!isRecord(value.autorunUser)) return null;
            const limitMinutes = value.autorunUser.limitMinutes;
            const options = value.autorunUser.options;
            if (
                !Number.isInteger(limitMinutes) ||
                (limitMinutes as number) < 1 ||
                (limitMinutes as number) > 43200 ||
                !Array.isArray(options) ||
                options.length === 0 ||
                !options.every(
                    (option): option is RuntimeAutorunUserOption =>
                        typeof option === 'string' && AUTORUN_OPTIONS.has(option as RuntimeAutorunUserOption)
                )
            ) {
                return null;
            }
            settings.autorunUser = {
                limitMinutes: limitMinutes as number,
                options: Array.from(new Set(options)),
            };
        }
    }
    return Object.keys(settings).length > 0 ? settings : null;
};

const ensureEngineCommand = async (
    db: GamePrismaClient,
    actionId: string,
    settings: RuntimeGameSettingsPatch
): Promise<{ requestId: string; result?: TurnDaemonCommandResult; failed?: string }> => {
    const requestId = `gateway-runtime:${actionId}`;
    const command: TurnDaemonCommand = {
        type: 'updateRuntimeSettings',
        requestId,
        actionId,
        settings,
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
        if (!isUniqueConflict(error)) throw error;
        const existing = await db.inputEvent.findUniqueOrThrow({
            where: { requestId },
            select: { eventType: true, payload: true },
        });
        const payload = existing.payload as Partial<TurnDaemonCommand>;
        if (
            existing.eventType !== command.type ||
            payload.type !== command.type ||
            payload.actionId !== actionId ||
            JSON.stringify(payload.settings) !== JSON.stringify(settings)
        ) {
            return { requestId, failed: '같은 action ID에 다른 런타임 설정 payload가 이미 존재합니다.' };
        }
    }

    const event = await db.inputEvent.findUniqueOrThrow({
        where: { requestId },
        select: { status: true, result: true, error: true },
    });
    if (event.status === 'FAILED') {
        return { requestId, failed: event.error ?? '게임 엔진 런타임 설정 변경이 실패했습니다.' };
    }
    if (event.status !== 'SUCCEEDED') return { requestId };
    return { requestId, result: event.result as TurnDaemonCommandResult };
};

const reprojectTournamentClock = async (
    redis: RuntimeSettingsRedisClient,
    profileName: string,
    actionId: string,
    result: Extract<TurnDaemonCommandResult, { type: 'updateRuntimeSettings'; ok: true }>
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
                if (!rawState) return false;
                const state = JSON.parse(rawState) as TournamentClockState;
                const applied = Array.isArray(state.runtimeSettingsActionIds)
                    ? state.runtimeSettingsActionIds.filter((entry): entry is string => typeof entry === 'string')
                    : [];
                if (applied.includes(actionId)) return true;
                const previousClock = new GameClock({
                    baseTime: new Date(result.previousClockBaseTime),
                    tick: 0,
                    mode: 'manual',
                    wallAnchor: new Date(result.previousClockBaseTime),
                    turnSeconds: result.previousTurnTermMinutes * 60,
                });
                const nextClock = new GameClock({
                    baseTime: new Date(result.clockBaseTime),
                    tick: 0,
                    mode: 'manual',
                    wallAnchor: new Date(result.clockBaseTime),
                    turnSeconds: result.turnTermMinutes * 60,
                });
                const reproject = (value: string | undefined): string | undefined => {
                    if (!value) return value;
                    const parsed = new Date(value);
                    if (Number.isNaN(parsed.getTime())) return value;
                    return nextClock.tickToDate(previousClock.dateToTick(parsed)).toISOString();
                };
                const nextState: TournamentClockState = {
                    ...state,
                    nextAt: reproject(state.nextAt),
                    bettingCloseAt: reproject(state.bettingCloseAt),
                    runtimeSettingsActionIds: [...applied, actionId],
                };
                await writeTournamentProjection(redis, sourceKeys, [{ key: stateKey, value: nextState }]);
                return true;
            } finally {
                if ((await redis.get(lockKey)) === token) await redis.del(lockKey);
            }
        }
        await sleep(10);
    }
    throw new Error('토너먼트 턴 간격 변경 lock을 획득하지 못했습니다.');
};

export const applyRuntimeGameSettings = async (options: {
    action: GatewayAdminActionRecord;
    profileName: string;
    db: GamePrismaClient;
    redis?: RuntimeSettingsRedisClient;
}): Promise<GatewayAdminActionResult> => {
    const { action, profileName, db, redis } = options;
    if (!action.id) return { status: 'FAILED', detail: '런타임 설정 action ID가 없습니다.' };
    const settings = normalizeSettings(action.payload?.settings);
    if (!settings) return { status: 'FAILED', detail: '런타임 설정 payload가 올바르지 않습니다.' };
    const engine = await ensureEngineCommand(db, action.id, settings);
    if (engine.failed) return { status: 'FAILED', detail: engine.failed };
    if (!engine.result) return { status: 'REQUESTED', detail: `게임 엔진 처리 대기 중: ${engine.requestId}` };
    if (engine.result.type !== 'updateRuntimeSettings' || !engine.result.ok) {
        return {
            status: 'FAILED',
            detail:
                engine.result.type === 'updateRuntimeSettings'
                    ? engine.result.reason
                    : '게임 엔진이 다른 결과를 반환했습니다.',
        };
    }
    if (engine.result.termChanged && !redis) {
        return {
            status: 'PARTIAL',
            detail: `DB 설정은 적용됐지만 Redis 토너먼트 시각 동기화를 기다리는 중입니다: ${engine.requestId}`,
        };
    }
    const tournamentReprojected =
        engine.result.termChanged && redis
            ? await reprojectTournamentClock(redis, profileName, action.id, engine.result)
            : false;
    const summary = [
        `턴 ${engine.result.turnTermMinutes}분`,
        settings.blockGeneralCreate === undefined ? null : `장수 생성 ${settings.blockGeneralCreate}`,
        settings.autorunUser === undefined
            ? null
            : settings.autorunUser === null
              ? '유저 자동턴 끔'
              : `유저 자동턴 ${settings.autorunUser.limitMinutes}분`,
        engine.result.termChanged ? `장수 ${engine.result.shiftedGenerals}명 시각 보정` : null,
        tournamentReprojected ? '토너먼트 시각 보정' : null,
    ].filter((entry): entry is string => entry !== null);
    return { status: 'APPLIED', detail: summary.join(' · ') };
};
